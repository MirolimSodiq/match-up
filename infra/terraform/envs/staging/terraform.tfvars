# Staging qiymatlari. Domen va zone — haqiqiy qiymatlar bilan almashtiring (DEPLOYMENT.md).
route53_zone_id = "Z0000000000000000000"
api_domain      = "api.staging.matchup.uz"
admin_domain    = "admin.staging.matchup.uz"

# Har deploy'da CI/operator yangi tegni beradi: -var api_image_tag=$(git rev-parse --short HEAD)
api_image_tag   = "initial"
admin_image_tag = "initial"
