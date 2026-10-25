import { useEffect, useState } from "react";
import { api, qs } from "../api";
import DateInput from "../components/DateInput";
import { MultiSelect } from "../components/Select";
import { dateTime } from "../lib/format";
import type { AuditEntry } from "../types";

interface Page {
  total: number;
  items: AuditEntry[];
  actions: Record<string, string>;
  actors: string[];
}

const PAGE = 50;

export default function Audit() {
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);

  const filters = { q: query.trim(), action: actions, actor: actors, date_from: from, date_to: to };
  const filterQs = qs(filters);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api<Page>(`/audit${filterQs}${filterQs ? "&" : "?"}limit=${PAGE}`)
        .then((p) => alive && setPage(p))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [filterQs]);

  const more = async () => {
    if (!page) return;
    setLoading(true);
    try {
      const next = await api<Page>(`/audit${qs({ ...filters, limit: PAGE, offset: page.items.length })}`);
      setPage({ ...next, items: [...page.items, ...next.items] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>Аудит</h1>
      <div className="toolbar">
        <input className="input search" placeholder="Поиск по описанию, пользователю, IP" value={query} onChange={(e) => setQuery(e.target.value)} />
        <MultiSelect
          label="Действие"
          values={actions}
          onChange={setActions}
          searchable
          options={Object.entries(page?.actions ?? {}).map(([value, label]) => ({ value, label, text: label }))}
        />
        <MultiSelect label="Пользователь" values={actors} onChange={setActors} searchable options={(page?.actors ?? []).map((a) => ({ value: a, label: a, text: a }))} />
        <div style={{ width: 130 }}>
          <DateInput value={from} onChange={setFrom} placeholder="С даты" />
        </div>
        <div style={{ width: 130 }}>
          <DateInput value={to} onChange={setTo} placeholder="По дату" />
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Пользователь</th>
              <th className="hide-sm">Действие</th>
              <th>Описание</th>
              <th className="hide-sm">IP</th>
            </tr>
          </thead>
          <tbody>
            {page?.items.map((e) => (
              <tr key={e.id} style={{ cursor: "default" }}>
                <td style={{ whiteSpace: "nowrap" }}>{dateTime(e.created_at)}</td>
                <td>{e.actor_name}</td>
                <td className="hide-sm">
                  <span className={`pill ${e.action === "auth.login_failed" ? "overdue" : ""}`}>{page.actions[e.action] ?? e.action}</span>
                </td>
                <td>{e.summary}</td>
                <td className="hide-sm mono">{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {page && page.items.length === 0 && <div className="table-empty">Записей не найдено</div>}
      </div>
      {page && page.items.length < page.total && (
        <button type="button" className="btn" style={{ alignSelf: "center" }} disabled={loading} onClick={more}>
          Показать ещё ({page.total - page.items.length})
        </button>
      )}
    </div>
  );
}
