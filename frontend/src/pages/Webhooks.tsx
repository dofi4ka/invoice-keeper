import { useEffect, useState } from "react";
import { api, invalidate, useQuery } from "../api";
import { Select } from "../components/Select";
import { Emoji, Kv, Side, Switch, toast } from "../components/ui";
import { dateTime } from "../lib/format";
import type { Webhook } from "../types";

interface Meta {
  events: Record<string, string>;
  default_template: string;
  sample_payload: Record<string, unknown>;
}

const METHODS = ["POST", "PUT", "PATCH", "GET", "DELETE"];
const AUTH_OPTIONS = [
  { value: "none", label: "Без авторизации" },
  { value: "basic", label: "Basic (логин и пароль)" },
  { value: "bearer", label: "Bearer токен" },
  { value: "header", label: "Ключ в заголовке" },
] as const;

const TEMPLATE_EXAMPLE = `{
  "text": {{ (event_title ~ ": " ~ invoice.name ~ " — " ~ occurrence.amount_text) | tojson }},
  "due": "{{ occurrence.due_date }}",
  "url": "{{ occurrence.url }}"
}`;

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type Draft = Omit<Webhook, "id" | "last_status" | "last_error" | "last_sent_at">;

const EMPTY: Draft = {
  name: "",
  url: "",
  method: "POST",
  events: ["occurrence.reminder", "occurrence.overdue"],
  headers: [],
  auth_type: "none",
  auth: {},
  content_type: "application/json",
  body_template: "",
  enabled: true,
};

/** CreateEditWebhook.html */
function WebhookForm({ hook, meta, onDone }: { hook: Webhook | null; meta: Meta | undefined; onDone: (id: number | null) => void }) {
  const [d, setD] = useState<Draft>(hook ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((x) => ({ ...x, [key]: value }));

  useEffect(() => setPreview(null), [d.body_template]);

  const save = async () => {
    setError(null);
    try {
      const saved = hook
        ? await api<Webhook>(`/webhooks/${hook.id}`, { method: "PUT", json: d })
        : await api<Webhook>("/webhooks", { method: "POST", json: d });
      toast(hook ? "Вебхук сохранён" : "Вебхук создан");
      invalidate();
      onDone(saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const test = async () => {
    if (!hook) return;
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; status: number | null; error: string | null }>(`/webhooks/${hook.id}/test`, { method: "POST" });
      toast(r.ok ? `Доставлено: HTTP ${r.status}` : `Ошибка: ${r.error}`);
      invalidate();
    } finally {
      setTesting(false);
    }
  };

  const auth = (key: string, value: string) => set("auth", { ...d.auth, [key]: value });

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Kv label="Название">
        <input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus={!hook} />
      </Kv>
      <Kv label="URL">
        <input className="input" value={d.url} placeholder="https://" onChange={(e) => set("url", e.target.value)} />
      </Kv>
      <Kv label="Метод">
        <Select value={d.method} onChange={(v) => set("method", v)} options={METHODS.map((m) => ({ value: m, label: m }))} />
      </Kv>
      <Kv label="Включён">
        <Switch on={d.enabled} onChange={(v) => set("enabled", v)} />
      </Kv>

      <div className="divider" />
      <p className="muted">События</p>
      <div className="chips">
        {Object.entries(meta?.events ?? {}).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`chip ${d.events.includes(key) ? "on" : ""}`}
            onClick={() => set("events", d.events.includes(key) ? d.events.filter((x) => x !== key) : [...d.events, key])}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="divider" />
      <Kv label="Авторизация">
        <Select value={d.auth_type} onChange={(v) => set("auth_type", v)} options={AUTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      </Kv>
      {d.auth_type === "basic" && (
        <>
          <Kv label="Логин">
            <input className="input" value={d.auth.username ?? ""} onChange={(e) => auth("username", e.target.value)} />
          </Kv>
          <Kv label="Пароль">
            <input className="input" type="password" value={d.auth.password ?? ""} onChange={(e) => auth("password", e.target.value)} />
          </Kv>
        </>
      )}
      {d.auth_type === "bearer" && (
        <Kv label="Токен">
          <input className="input" value={d.auth.token ?? ""} onChange={(e) => auth("token", e.target.value)} />
        </Kv>
      )}
      {d.auth_type === "header" && (
        <>
          <Kv label="Заголовок">
            <input className="input" placeholder="X-Api-Key" value={d.auth.name ?? ""} onChange={(e) => auth("name", e.target.value)} />
          </Kv>
          <Kv label="Значение">
            <input className="input" value={d.auth.value ?? ""} onChange={(e) => auth("value", e.target.value)} />
          </Kv>
        </>
      )}

      <div className="kv">
        <p>Заголовки</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm" onClick={() => set("headers", [...d.headers, { name: "", value: "" }])}>
            Добавить
          </button>
        </div>
      </div>
      {d.headers.map((h, i) => (
        <div className="header-row" key={i}>
          <input
            className="input compact"
            placeholder="Имя"
            value={h.name}
            onChange={(e) => set("headers", d.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            className="input compact"
            placeholder="Значение"
            value={h.value}
            onChange={(e) => set("headers", d.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button type="button" className="icon-btn" aria-label="Удалить заголовок" onClick={() => set("headers", d.headers.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}

      {d.method !== "GET" && (
        <>
          <Kv label="Content-Type">
            <input className="input" value={d.content_type} onChange={(e) => set("content_type", e.target.value)} />
          </Kv>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="muted" data-tip="Jinja2: доступны event, event_title, invoice, occurrence, actor и payload целиком">
              Тело запроса
            </p>
            <button type="button" className="link-btn" onClick={() => set("body_template", TEMPLATE_EXAMPLE)}>
              Пример
            </button>
          </div>
          <textarea
            className="input mono"
            spellCheck={false}
            placeholder={`Пусто — отправляется весь payload:\n${meta?.default_template ?? ""}`}
            value={d.body_template}
            onChange={(e) => set("body_template", e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const r = await api<{ body: string }>("/webhooks/preview", { method: "POST", json: { body_template: d.body_template } });
              setPreview(r.body);
            }}
          >
            Предпросмотр на тестовых данных
          </button>
          {preview !== null && <pre className="code-hint">{preview}</pre>}
        </>
      )}

      {hook?.last_sent_at && (
        <Kv label="Последняя отправка">
          <span className={hook.last_error ? "pill overdue" : "pill paid"} data-tip={hook.last_error ?? undefined}>
            {hook.last_status ?? "—"} · {dateTime(hook.last_sent_at)}
          </span>
        </Kv>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {hook ? "Сохранить" : "Создать"}
        </button>
        {hook && (
          <button type="button" className="btn" disabled={testing} onClick={test} data-tip="Отправить тестовое событие на сохранённые настройки">
            Тест
          </button>
        )}
        {hook && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm(`Удалить вебхук «${hook.name}»?`)) return;
              await api(`/webhooks/${hook.id}`, { method: "DELETE" });
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

export default function Webhooks() {
  const { data } = useQuery<Webhook[]>("/webhooks");
  const { data: meta } = useQuery<Meta>("/webhooks/meta");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const q = query.trim().toLowerCase();
  const rows = (data ?? []).filter((h) => !q || h.name.toLowerCase().includes(q) || h.url.toLowerCase().includes(q));
  const current = typeof selected === "number" ? data?.find((h) => h.id === selected) ?? null : null;

  return (
    <div className="page">
      <h1>Вебхуки</h1>
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
                  <th>Название</th>
                  <th>Адрес</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id} className={selected === h.id ? "selected" : ""} onClick={() => setSelected(h.id)} style={h.enabled ? undefined : { opacity: 0.5 }}>
                    <td>{h.name}</td>
                    <td>
                      <span className="mono">{h.method}</span> {hostOf(h.url)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && rows.length === 0 && <div className="table-empty">Вебхуков пока нет</div>}
          </div>
        </div>
        <Side open={selected !== null} onClose={() => setSelected(null)}>
          {selected === null ? (
            <div className="side-empty"><span><Emoji e="👆" /> Выберите вебхук</span></div>
          ) : (
            <WebhookForm key={String(selected)} hook={current} meta={meta} onDone={(id) => setSelected(id)} />
          )}
        </Side>
      </div>
    </div>
  );
}
