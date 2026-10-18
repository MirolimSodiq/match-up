import { useState } from 'react';
import { OtpStep } from '@/features/auth/OtpStep';
import { type OtpChallenge, PhoneStep } from '@/features/auth/PhoneStep';

/** Telefon + OTP. Bitta route: tizimdan chiqqan foydalanuvchi uchun yagona ochiq ekran. */
export default function LoginScreen() {
  const [challenge, setChallenge] = useState<OtpChallenge>();
  if (challenge) return <OtpStep challenge={challenge} onBack={() => setChallenge(undefined)} />;
  return <PhoneStep onSent={setChallenge} />;
}
