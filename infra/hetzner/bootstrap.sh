#!/usr/bin/env bash
# Match Up — yangi serverni bir marta tayyorlash (docs/DEPLOYMENT.md §10). root sifatida, Ubuntu 24.04 (yoki 22.04,
# Debian 12/13). Qayta ishga tushirish xavfsiz: mavjud kalitlar, .env va sozlamalar o'zgartirilmaydi.
#
#   scp infra/hetzner/bootstrap.sh root@<ip>:
#   ssh root@<ip> bash bootstrap.sh --email ops@example.com
#
# Opsiyalar:
#   --email ADDR        Let's Encrypt hisobi (.env ACME_EMAIL)
#   --deploy-key KEY    GitHub Actions uchun ochiq kalit ("ssh-ed25519 AAAA..."); berilmasa — juftlik yaratiladi va
#                       maxfiy qismi bir marta ekranga chiqariladi (GitHub secret HETZNER_SSH_KEY ga)
#   --swap SIZE         swap fayl hajmi, swap bo'lmasa (standart 4G; 0 — yaratilmaydi)
#
# Nima qiladi: Docker (rasmiy repo), `deploy` foydalanuvchisi (docker guruhi, faqat kalit bilan, `restrict`),
# ufw (SSH, 80, 443), fail2ban, avtomatik xavfsizlik yangilanishlari, swap, /opt/matchup (Ed25519 kalitlar,
# generatsiya qilingan .env), kunlik backup timer'i, `matchup` buyrug'i.
set -euo pipefail

MATCHUP_HOME=/opt/matchup
DEPLOY_USER=deploy
NODE_UID=1000 # API konteyneridagi `node` — secrets/*.pem shu uid'ga o'qiladi

email='' deploy_key='' swap_size=4G
while (( $# )); do
  case $1 in
    --email) email=${2:?}; shift 2 ;;
    --deploy-key) deploy_key=${2:?}; shift 2 ;;
    --swap) swap_size=${2:?}; shift 2 ;;
    *) sed -n '2,15p' "$0" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'XATO: %s\n' "$*" >&2; exit 1; }

(( EUID == 0 )) || die "root sifatida ishga tushiring"
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == ubuntu || ${ID:-} == debian ]] || die "faqat Ubuntu/Debian ($ID)"
export DEBIAN_FRONTEND=noninteractive

metadata() { curl -fsS -m 3 "http://169.254.169.254/hetzner/v1/metadata/$1" 2>/dev/null || true; }

install_packages() {
  log "Paketlar va yangilanishlar"
  apt-get update -q
  apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
  apt-get -y -q install ca-certificates curl gnupg openssl ufw fail2ban unattended-upgrades
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

install_docker() {
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    log "Docker (download.docker.com)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
  if [[ ! -f /etc/docker/daemon.json ]]; then
    # Log'lar diskni to'ldirmasin; live-restore — dockerd yangilanganda konteynerlar to'xtamaydi
    cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null
}

setup_swap() {
  if [[ $swap_size != 0 && -z $(swapon --show --noheadings) ]]; then
    log "Swap $swap_size"
    fallocate -l "$swap_size" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
  # Valkey (fork bilan AOF qayta yozish) uchun overcommit; swap faqat oxirgi chora
  printf 'vm.swappiness = 10\nvm.overcommit_memory = 1\n' >/etc/sysctl.d/99-matchup.conf
  sysctl -q --system >/dev/null || echo "OGOHLANTIRISH: sysctl qo'llanmadi"
}

setup_user() {
  log "Foydalanuvchi: $DEPLOY_USER"
  id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  local home ssh_dir keys tmp
  home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
  ssh_dir="$home/.ssh"
  keys="$ssh_dir/authorized_keys"
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
  touch "$keys"
  if [[ -z $deploy_key ]] && ! grep -q '^restrict ' "$keys"; then
    tmp=$(mktemp -d)
    ssh-keygen -q -t ed25519 -N '' -C matchup-deploy -f "$tmp/key"
    deploy_key=$(<"$tmp/key.pub")
    GENERATED_PRIVATE_KEY=$(<"$tmp/key")
    rm -rf "$tmp"
  fi
  if [[ -n $deploy_key ]] && ! grep -qF "${deploy_key#restrict }" "$keys"; then
    [[ $deploy_key == ssh-* || $deploy_key == ecdsa-* ]] || die "--deploy-key: OpenSSH ochiq kaliti kerak"
    # restrict: port forwarding, agent, pty yo'q — faqat buyruq bajarish (deploy)
    printf 'restrict %s\n' "${deploy_key#restrict }" >>"$keys"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
  chmod 0600 "$keys"
}

setup_layout() {
  log "$MATCHUP_HOME"
  install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
    "$MATCHUP_HOME" "$MATCHUP_HOME/releases" "$MATCHUP_HOME/state" "$MATCHUP_HOME/caddy"
  # Kalitlar: konteynerdagi node (uid 1000) o'qiydi; deploy foydalanuvchisi faqat ro'yxatni ko'radi
  install -d -m 0750 -o root -g "$DEPLOY_USER" "$MATCHUP_HOME/secrets"
  local name
  for name in jwt ticket; do
    if [[ ! -f $MATCHUP_HOME/secrets/${name}_private.pem ]]; then
      openssl genpkey -algorithm ed25519 -out "$MATCHUP_HOME/secrets/${name}_private.pem"
      openssl pkey -in "$MATCHUP_HOME/secrets/${name}_private.pem" -pubout -out "$MATCHUP_HOME/secrets/${name}_public.pem"
    fi
  done
  chown "$NODE_UID:$NODE_UID" "$MATCHUP_HOME"/secrets/*.pem
  chmod 0400 "$MATCHUP_HOME"/secrets/*.pem
  touch "$MATCHUP_HOME/state/image.env"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$MATCHUP_HOME/state/image.env"
}

write_env() {
  local env_file="$MATCHUP_HOME/.env" ip host location endpoint
  [[ -f $env_file ]] && { log ".env mavjud — o'zgartirilmadi"; return; }
  log ".env"
  ip=$(metadata public-ipv4)
  [[ $ip =~ ^[0-9.]+$ ]] || ip=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  host=${ip//./-}.sslip.io
  location=$(metadata availability-zone)
  location=${location%%-*}
  endpoint=https://${location:-change-me}.your-objectstorage.com
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "$env_file"
  cat >"$env_file" <<EOF
# Match Up production — to'liq ro'yxat va izohlar: infra/hetzner/env.example (serverda: $MATCHUP_HOME/current/env.example).
# "change-me" qiymatlarini almashtiring; o'zgartirgandan keyin: $MATCHUP_HOME/current/deploy.sh --restart

# Domen bo'lmaguncha — sslip.io ($ip)
API_DOMAIN=api.$host
ADMIN_DOMAIN=admin.$host
ACME_EMAIL=${email:-change-me@example.com}

# Generatsiya qilingan (o'zgartirmang: DB paroli faqat birinchi ishga tushirishda qo'llanadi)
DB_PASSWORD=$(openssl rand -hex 24)
MEDIA_WORKER_TOKEN=$(openssl rand -hex 32)

# Hetzner Object Storage (bucket'lar va S3 kalitlari — Console -> Object Storage)
S3_ENDPOINT=$endpoint
S3_REGION=${location:-change-me}
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
MEDIA_RAW_BUCKET=change-me
MEDIA_BUCKET=change-me
BACKUP_BUCKET=change-me

# SMS (Eskiz) — API usiz ishga tushmaydi (login kodlari)
ESKIZ_EMAIL=change-me@example.com
ESKIZ_PASSWORD=change-me
EOF
}

setup_firewall() {
  log "Firewall (ufw)"
  local port
  mkdir -p /run/sshd
  port=$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}') || true
  ufw allow "${port:-22}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  # journald orqali (minimal image'larda /var/log/auth.log bo'lmasligi mumkin)
  printf '[sshd]\nenabled = true\nbackend = systemd\n' >/etc/fail2ban/jail.d/matchup.local
  { systemctl enable fail2ban && systemctl restart fail2ban; } >/dev/null 2>&1 || echo "OGOHLANTIRISH: fail2ban ishga tushmadi"
}

harden_ssh() {
  if [[ -s /root/.ssh/authorized_keys ]]; then
    log "SSH: faqat kalit bilan"
    cat >/etc/ssh/sshd_config.d/10-matchup.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    mkdir -p /run/sshd
    if ! sshd -t; then
      rm -f /etc/ssh/sshd_config.d/10-matchup.conf
      die "sshd konfiguratsiyasi tekshiruvdan o'tmadi — o'zgartirilmadi"
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
  else
    SSH_WARNING="root'da SSH kalit yo'q — parol bilan kirish yoqiq qoldi. Kalit qo'shib, skriptni qayta ishga tushiring."
  fi
}

install_units() {
  log "Backup timer va matchup buyrug'i"
  cat >/etc/systemd/system/matchup-backup.service <<EOF
[Unit]
Description=Match Up PostgreSQL backup (Object Storage)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$DEPLOY_USER
Group=$DEPLOY_USER
ExecStart=$MATCHUP_HOME/current/backup.sh
EOF
  # 21:30 UTC = 02:30 Toshkent
  cat >/etc/systemd/system/matchup-backup.timer <<'EOF'
[Unit]
Description=Match Up kunlik backup

[Timer]
OnCalendar=*-*-* 21:30:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now matchup-backup.timer >/dev/null
  cat >/usr/local/bin/matchup <<EOF
#!/bin/sh
exec $MATCHUP_HOME/current/matchup "\$@"
EOF
  chmod 0755 /usr/local/bin/matchup
}

summary() {
  local ip
  ip=$(metadata public-ipv4)
  [[ -n $ip ]] || ip=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  log "Tayyor"
  cat <<EOF

GitHub -> repo Settings -> Secrets and variables -> Actions:
  Variables:  HETZNER_HOST = $ip
              HETZNER_KNOWN_HOSTS = $ip $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
EOF
  if [[ -n ${GENERATED_PRIVATE_KEY:-} ]]; then
    cat <<EOF
  Secrets:    HETZNER_SSH_KEY = pastdagi kalit (BEGIN va END qatorlari bilan). Serverda saqlanmadi —
              hozir nusxalang, boshqa joyga yozmang.

$GENERATED_PRIVATE_KEY

EOF
  else
    echo "  Secrets:    HETZNER_SSH_KEY = avval berilgan/yaratilgan kalitning maxfiy qismi (yo'qolgan bo'lsa:"
    echo "              ~$DEPLOY_USER/.ssh/authorized_keys dan 'restrict' qatorini o'chirib, skriptni qayta ishga tushiring)"
  fi
  cat <<EOF
Keyin: $MATCHUP_HOME/.env dagi "change-me" qiymatlarini to'ldiring (nano $MATCHUP_HOME/.env) va
Actions -> "Deploy (Hetzner)" -> Run workflow.
EOF
  [[ -z ${SSH_WARNING:-} ]] || printf '\nOGOHLANTIRISH: %s\n' "$SSH_WARNING"
}

install_packages
install_docker
setup_swap
setup_user
setup_layout
write_env
setup_firewall
harden_ssh
install_units
summary
