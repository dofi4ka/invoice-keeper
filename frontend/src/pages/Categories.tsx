import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { api, invalidate, useQuery } from "../api";
import { CategoryIcon, Emoji, Kv, Side, toast } from "../components/ui";
import { CURRENCIES, type CategoryWithSpend } from "../types";
import { complex, type Totals } from "../lib/format";

const ICON_SETS = "mdi,material-symbols,ph,tabler,lucide,ri,mingcute,solar,carbon,fluent";
const DEFAULT_ICONS = [
  "mdi:office-building", "mdi:server", "mdi:credit-card-outline", "mdi:phone", "mdi:calculator", "mdi:cloud-outline",
  "mdi:web", "mdi:email-outline", "mdi:car", "mdi:home-outline", "mdi:lightning-bolt", "mdi:water",
  "mdi:wifi", "mdi:shield-check-outline", "mdi:briefcase-outline", "mdi:cart-outline", "mdi:school-outline", "mdi:food",
  "mdi:airplane", "mdi:bank-outline", "mdi:chart-line", "mdi:account-group-outline", "mdi:printer-outline", "mdi:tools",
];

function useIconSearch(query: string) {
  const [icons, setIcons] = useState<string[]>(DEFAULT_ICONS);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setIcons(DEFAULT_ICONS);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=96&prefixes=${ICON_SETS}`, { signal: controller.signal });
        const data = (await r.json()) as { icons?: string[] };
        setIcons(data.icons ?? []);
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  return { icons, loading };
}

/** CreateEditCategoryForm.html */
function CategoryForm({ category, onDone }: { category: CategoryWithSpend | null; onDone: (id: number | null) => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { icons, loading } = useIconSearch(query);

  const save = async () => {
    if (!name.trim()) return setError("Укажите название");
    try {
      const body = { name: name.trim(), icon };
      const saved = category
        ? await api<CategoryWithSpend>(`/categories/${category.id}`, { method: "PATCH", json: body })
        : await api<CategoryWithSpend>("/categories", { method: "POST", json: body });
      toast(category ? "Категория сохранена" : "Категория создана");
      invalidate();
      onDone(saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Kv label="Название">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!category} />
      </Kv>
      <Kv label="Иконка" tip="Иконка показывается рядом со всеми платежами этой категории">
        <div className="input-group" style={{ width: "100%" }}>
          <input className="input" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="input-icon icon-btn">{loading ? <span className="spinner" /> : <CategoryIcon icon={icon} />}</span>
        </div>
      </Kv>
      <div className="icon-grid">
        {icons.map((name) => (
          <button type="button" key={name} title={name} className={name === icon ? "on" : ""} onClick={() => setIcon(name)}>
            <Icon icon={name} width={22} height={22} color="#000" />
          </button>
        ))}
        {!loading && icons.length === 0 && <span className="muted" style={{ gridColumn: "1 / -1" }}>Ничего не найдено</span>}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {category ? "Сохранить" : "Создать"}
        </button>
        {category && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm(`Удалить категорию «${category.name}»? Платежи останутся без категории.`)) return;
              await api(`/categories/${category.id}`, { method: "DELETE" });
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

export default function Categories() {
  const { data } = useQuery<CategoryWithSpend[]>("/categories");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const q = query.trim().toLowerCase();
  const rows = (data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const current = typeof selected === "number" ? data?.find((c) => c.id === selected) ?? null : null;

  return (
    <div className="page">
      <h1>Категории</h1>
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
                  <th style={{ width: 48 }} />
                  <th>Название</th>
                  <th className="num" data-tip="Сумма платежей со сроком за последние 30 дней">
                    За последний месяц
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const totals: Totals = {};
                  CURRENCIES.forEach((cur) => c.last_month[cur] && (totals[cur] = Number(c.last_month[cur])));
                  return (
                    <tr key={c.id} className={selected === c.id ? "selected" : ""} onClick={() => setSelected(c.id)}>
                      <td>
                        <CategoryIcon icon={c.icon} size={22} />
                      </td>
                      <td>{c.name}</td>
                      <td className="num">{complex(totals, "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && rows.length === 0 && <div className="table-empty">Категорий нет</div>}
          </div>
        </div>
        <Side open={selected !== null} onClose={() => setSelected(null)}>
          {selected === null ? (
            <div className="side-empty"><span><Emoji e="👆" /> Выберите категорию</span></div>
          ) : (
            <CategoryForm key={String(selected)} category={current} onDone={(id) => setSelected(id)} />
          )}
        </Side>
      </div>
    </div>
  );
}
