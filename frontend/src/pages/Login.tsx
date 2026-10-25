import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { EyeIcon } from "../components/ui";

export default function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (ready && user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Введите почту и пароль");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message || "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-form" onSubmit={submit}>
        <p className="welcome">
          Welcome to <span>Invoice Keeper</span>
        </p>
        <input
          className="input"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <div className="pw">
          <input
            className="input"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => setShow(!show)} aria-label={show ? "Скрыть пароль" : "Показать пароль"}>
            <EyeIcon off={show} />
          </button>
        </div>
        <small className="login-error">{error}</small>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Войти
        </button>
      </form>
      <img className="login-art" src="/mascot.webp" alt="Aéza-тян" />
    </div>
  );
}
