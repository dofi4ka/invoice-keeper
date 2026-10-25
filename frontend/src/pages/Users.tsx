import { useState } from "react";
import { api, invalidate, useQuery } from "../api";
import { EyeIcon, Kv, Side, toast } from "../components/ui";
import type { User } from "../types";

/** CreateEditUserForm.html */
function UserForm({ user, onDone }: { user: User | null; onDone: (id: number | null) => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState(user?.role ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim() || !email.trim()) return setError("Укажите имя и почту");
    if (!user && password.length < 6) return setError("Пароль должен быть не короче 6 символов");
    try {
      const body: Record<string, unknown> = { name: name.trim(), role: role.trim() || null, email: email.trim() };
      if (password) body.password = password;
      const saved = user
        ? await api<User>(`/users/${user.id}`, { method: "PATCH", json: body })
        : await api<User>("/users", { method: "POST", json: body });
      toast(user ? "Сотрудник сохранён" : "Сотрудник добавлен");
      invalidate();
      setPassword("");
      onDone(saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form
      className="form"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Kv label="Имя">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!user} />
      </Kv>
      <Kv label="Роль">
        <input className="input" value={role} placeholder="Необязательно" onChange={(e) => setRole(e.target.value)} />
      </Kv>
      <Kv label="Почта">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Kv>
      <Kv label={user ? "Новый пароль" : "Пароль"} tip={user ? "Оставьте пустым, чтобы не менять пароль" : undefined}>
        <div className="input-group" style={{ width: "100%" }}>
          <input
            className="input"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="input-icon icon-btn" onClick={() => setShow(!show)} aria-label="Показать пароль">
            <EyeIcon off={show} />
          </button>
        </div>
      </Kv>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {user ? "Сохранить" : "Добавить"}
        </button>
        {user && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm(`Удалить ${user.name}?`)) return;
              await api(`/users/${user.id}`, { method: "DELETE" });
              toast("Сотрудник удалён");
              invalidate();
              onDone(null);
            }}
          >
            Удалить
          </button>
        )}
      </div>
    </form>
  );
}

export default function Users() {
  const { data } = useQuery<User[]>("/users");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const q = query.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (u) => !q || [u.name, u.email, u.role ?? ""].some((v) => v.toLowerCase().includes(q)),
  );
  const current = typeof selected === "number" ? data?.find((u) => u.id === selected) ?? null : null;

  return (
    <div className="page">
      <h1>Команда</h1>
      <div className="split">
        <div className="split-main">
          <div className="toolbar">
            <input className="input search" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="btn btn-primary" onClick={() => setSelected("new")}>
              Добавить
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Роль</th>
                  <th className="hide-sm">Почта</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    className={selected === u.id ? "selected" : ""}
                    onClick={() => (u.is_admin ? toast("Администратор задаётся в .env и не редактируется в панели") : setSelected(u.id))}
                    style={u.is_admin ? { cursor: "default" } : undefined}
                  >
                    <td>{u.name}</td>
                    <td>{u.is_admin ? <span className="pill">Админ</span> : u.role || <span className="muted">—</span>}</td>
                    <td className="hide-sm">{u.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && rows.length === 0 && <div className="table-empty">Никого не найдено</div>}
          </div>
        </div>
        <Side open={selected !== null} onClose={() => setSelected(null)}>
          {selected === null ? (
            <div className="side-empty">👆 Выберите сотрудника</div>
          ) : (
            <UserForm key={String(selected)} user={current} onDone={(id) => setSelected(id)} />
          )}
        </Side>
      </div>
    </div>
  );
}
