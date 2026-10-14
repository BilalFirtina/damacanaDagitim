import React, { useState } from 'react';
import { User } from '../../types';
import { loginUser } from '../../services/api';
import {
  Truck,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Check,
  ArrowRight,
  Download
} from 'lucide-react';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface LoginViewProps {
  onLoginSuccess: (user: User, rememberMe: boolean) => void;
  availableUsers?: User[];
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  availableUsers = [],
}) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !pin.trim()) {
      setErrorMsg('Lütfen kullanıcı adı ve şifre giriniz.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      const user = await loginUser(username.trim(), pin.trim());
      onLoginSuccess(user, rememberMe);
    } catch (err: any) {
      setErrorMsg(err.message || 'Giriş başarısız. Kullanıcı adı veya şifre hatalı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col items-center justify-center p-4">
      {/* Top Brand Area */}
      <div className="w-full max-w-md mx-auto text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-600 to-sky-400 text-white shadow-xl shadow-sky-500/20 mb-3">
          <Truck className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          SuDağıtım<span className="text-sky-600">Pro</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Saha Dağıtım, Yükleme & Gün Sonu Kasa Mutabakat Portalı
        </p>

        {/* PWA Banner for mobile drivers on first arrival */}
        <div className="mt-3 flex justify-center">
          <PWAInstallButton />
        </div>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-2xl p-6 sm:p-8">
        <div className="mb-5">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Oturum Açın
          </h2>
          <p className="text-xs text-slate-500">
            Kullanıcı adı ve şifreniz ile sisteme giriş yapınız
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
              Kullanıcı Adı
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                autoComplete="username"
                placeholder="Kullanıcı adınızı girin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition"
              />
            </div>
          </div>

          {/* Password / PIN */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
              Şifre / PIN
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Şifrenizi girin"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Me */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
              />
              <span>Beni Hatırla (Cihazda açık tut)</span>
            </label>
          </div>

          {/* Login Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-98 text-white font-bold text-xs shadow-lg shadow-sky-600/25 flex items-center justify-center gap-2 transition-all mt-2"
          >
            <span>{isSubmitting ? 'Doğrulanıyor...' : 'Giriş Yap'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick User Picker Helper for convenience */}
        {availableUsers && availableUsers.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 text-center">
              Hızlı Profil Seçimi
            </span>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {availableUsers.map((u) => {
                const isAdmin = u.role === 'admin';
                const isLead = u.isLeadDriver || (u.role === 'driver' && u.canLoadVehicle);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setUsername(u.username);
                      setPin(u.pin);
                    }}
                    className={`p-2 rounded-xl border text-left transition-colors ${
                      isAdmin
                        ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-100/60'
                        : isLead
                        ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 hover:bg-emerald-100/60'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100'
                    }`}
                  >
                    <div
                      className={`text-xs font-bold ${
                        isAdmin
                          ? 'text-indigo-950 dark:text-indigo-200'
                          : isLead
                          ? 'text-emerald-950 dark:text-emerald-200'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {u.name}
                    </div>
                    <div
                      className={`text-[10px] font-medium leading-tight ${
                        isAdmin
                          ? 'text-indigo-700 dark:text-indigo-400'
                          : isLead
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {u.title || (isAdmin ? 'Depo Yöneticisi' : isLead ? 'Tek Yetkili Şoför' : 'Saha Dağıtım Şoförü')}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-6 text-center text-xs text-slate-400">
        SuDağıtım Pro © 2026 · Çevrimdışı ve Android PWA Uyumlu
      </div>
    </div>
  );
};
