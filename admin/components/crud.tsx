"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";
import { Modal, Field, Empty, ConfirmDelete, TableSkeleton, ErrorState } from "./ui";
import { ImageUpload } from "./image-upload";

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "image";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  half?: boolean;
  placeholder?: string;
  /** valeur par défaut à la création */
  default?: string | number | boolean | null;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Colonne triable (par défaut oui). Mettre `false` pour les colonnes
      composites/non pertinentes (ex. miniature, badge). */
  sortable?: boolean;
}

type FormValues = Record<string, string | number | boolean | null>;

interface CrudPageProps<T extends { id: string }> {
  title: string;
  endpoint: string; // ex: /v1/admin/artists
  columns: Column<T>[];
  fields: FieldConfig[];
  /** Droit de créer / éditer / supprimer (selon rôle). */
  canCreate?: boolean;
  canEdit?: (row: T) => boolean;
  canDelete?: (row: T) => boolean;
  /** Libellé d'une ligne pour la confirmation de suppression. */
  rowLabel: (row: T) => string;
  /** Transforme une ligne en valeurs de formulaire (édition). */
  toForm?: (row: T) => FormValues;
  /** Actions personnalisées par ligne (ex. téléversement audio). reload
      permet de rafraîchir la liste après l'action. */
  extraActions?: (row: T, reload: () => Promise<void>) => ReactNode;
  /** Post-traite le payload avant envoi (ex. regrouper des champs plats en
      objet `socials`). */
  transformPayload?: (payload: Record<string, unknown>, values: FormValues) => Record<string, unknown>;
}

function emptyForm(fields: FieldConfig[]): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    v[f.name] = f.default ?? (f.type === "checkbox" ? false : f.type === "number" ? "" : "");
  }
  return v;
}

function buildPayload(fields: FieldConfig[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.type === "checkbox") {
      out[f.name] = Boolean(raw);
    } else if (f.type === "number") {
      out[f.name] = raw === "" || raw == null ? null : Number(raw);
    } else {
      const s = typeof raw === "string" ? raw.trim() : raw;
      out[f.name] = s === "" ? null : s;
    }
  }
  return out;
}

export function CrudPage<T extends { id: string }>(props: CrudPageProps<T>) {
  const {
    title,
    endpoint,
    columns,
    fields,
    canCreate = true,
    canEdit = () => true,
    canDelete = () => true,
    rowLabel,
    toForm,
  } = props;

  const toast = useToast();
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Tri persistant (QW-1) : clé de colonne + sens. `null` = ordre naturel.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);

  const load = async () => {
    // Distingue l'erreur du vide : on remet rows à null (squelette) puis on
    // signale l'échec via un état d'erreur dédié (et non un tableau vide).
    setError(null);
    setRows(null);
    try {
      setRows(await api.get<T[]>(endpoint));
    } catch (e) {
      const msg = (e as ApiError).message || "Échec du chargement.";
      setError(msg);
      toast(msg, "error");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // QW-1 — Persistance recherche + tri dans l'URL (sans next/navigation pour
  // éviter la contrainte Suspense au build) : on lit l'état au montage…
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    const sort = sp.get("sort"); // format "clé:asc|desc"
    if (q) setQuery(q);
    if (sort) {
      const [k, d] = sort.split(":");
      if (k) {
        setSortKey(k);
        setSortDir(d === "desc" ? "desc" : "asc");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // …et on le réécrit (replaceState : pas d'entrée d'historique parasite).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const q = query.trim();
    q ? sp.set("q", q) : sp.delete("q");
    sortKey ? sp.set("sort", `${sortKey}:${sortDir}`) : sp.delete("sort");
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [query, sortKey, sortDir]);

  const openNew = () => {
    setValues(emptyForm(fields));
    setEditing("new");
  };
  const openEdit = (row: T) => {
    setValues(toForm ? toForm(row) : (row as unknown as FormValues));
    setEditing(row);
  };
  const close = () => setEditing(null);

  const save = async () => {
    // validation requise minimale
    for (const f of fields) {
      if (f.required && (values[f.name] === "" || values[f.name] == null)) {
        toast(`Champ requis : ${f.label}`, "warn");
        return;
      }
    }
    setSaving(true);
    try {
      let payload = buildPayload(fields, values);
      if (props.transformPayload) payload = props.transformPayload(payload, values);
      if (editing === "new") {
        await api.post(endpoint, payload);
        toast("Créé", "ok");
      } else if (editing) {
        await api.patch(`${endpoint}/${editing.id}`, payload);
        toast("Enregistré", "ok");
      }
      close();
      await load();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const isSortable = (c: Column<T>) => c.sortable !== false;
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const resetView = () => {
    setQuery("");
    setSortKey(null);
    setSortDir("asc");
  };
  const viewActive = query.trim().length > 0 || sortKey !== null;

  // Recherche instantanée (sur le libellé de ligne) puis tri (QW-1).
  const filtered =
    rows && query.trim()
      ? rows.filter((r) => rowLabel(r).toLowerCase().includes(query.trim().toLowerCase()))
      : rows;
  const visibleRows =
    filtered && sortKey
      ? [...filtered].sort((a, b) => {
          const dir = sortDir === "asc" ? 1 : -1;
          const av = (a as Record<string, unknown>)[sortKey];
          const bv = (b as Record<string, unknown>)[sortKey];
          if (av == null && bv == null) return 0;
          if (av == null) return 1; // valeurs vides en dernier
          if (bv == null) return -1;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
          return String(av).localeCompare(String(bv), "fr-CA", { numeric: true }) * dir;
        })
      : filtered;

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`${endpoint}/${deleting.id}`);
      toast("Supprimé", "ok");
      setDeleting(null);
      await load();
    } catch (e) {
      toast((e as ApiError).message, "error");
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>{title}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {rows && rows.length > 0 && (
            <input
              type="search"
              value={query}
              placeholder="Rechercher…"
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 200 }}
            />
          )}
          {rows && rows.length > 0 && viewActive && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={resetView}>
              Réinitialiser
            </button>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={openNew}>
              + Nouveau
            </button>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <TableSkeleton cols={columns.length + 1} />
      ) : rows.length === 0 ? (
        <Empty
          label="Aucune entrée pour l'instant."
          hint={canCreate ? "Crée ta première entrée — elle apparaîtra ici." : undefined}
          action={
            canCreate ? (
              <button className="btn btn-primary" type="button" onClick={openNew}>
                + Nouveau
              </button>
            ) : undefined
          }
        />
      ) : visibleRows && visibleRows.length === 0 ? (
        <Empty label={`Aucun résultat pour « ${query} ».`} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      isSortable(c)
                        ? sortKey === c.key
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                  >
                    {isSortable(c) ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        <span aria-hidden="true" className="th-arrow">
                          {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                <th scope="col" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(visibleRows ?? []).map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {props.extraActions?.(row, load)}
                      {canEdit(row) && (
                        <button className="btn btn-sm btn-ghost" onClick={() => openEdit(row)}>
                          Éditer
                        </button>
                      )}
                      {canDelete(row) && (
                        <button className="btn btn-sm btn-danger" onClick={() => setDeleting(row)}>
                          Suppr.
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing === "new" ? `Nouveau — ${title}` : `Éditer — ${title}`} onClose={close}>
          <FormFields fields={fields} values={values} onChange={setValues} />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={close} disabled={saving}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDelete what={rowLabel(deleting)} onConfirm={doDelete} onCancel={() => setDeleting(null)} />
      )}
    </div>
  );
}

function FormFields({
  fields,
  values,
  onChange,
}: {
  fields: FieldConfig[];
  values: FormValues;
  onChange: (v: FormValues) => void;
}) {
  const set = (name: string, val: string | number | boolean | null) =>
    onChange({ ...values, [name]: val });

  // Regroupe les champs `half` deux par deux.
  const rendered: ReactNode[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.half && fields[i + 1]?.half) {
      rendered.push(
        <div className="field-row" key={f.name}>
          {renderField(f, values, set)}
          {renderField(fields[i + 1]!, values, set)}
        </div>,
      );
      i++;
    } else {
      rendered.push(<div key={f.name}>{renderField(f, values, set)}</div>);
    }
  }
  return <>{rendered}</>;
}

function renderField(
  f: FieldConfig,
  values: FormValues,
  set: (name: string, val: string | number | boolean | null) => void,
) {
  const val = values[f.name];
  if (f.type === "checkbox") {
    return (
      <div className="field" key={f.name}>
        <div className="checkbox">
          <input
            type="checkbox"
            id={f.name}
            checked={Boolean(val)}
            onChange={(e) => set(f.name, e.target.checked)}
          />
          <label htmlFor={f.name} style={{ margin: 0 }}>
            {f.label}
          </label>
        </div>
        {f.hint && <span className="hint">{f.hint}</span>}
      </div>
    );
  }
  if (f.type === "image") {
    const url = (val as string) ?? "";
    return (
      <Field label={f.label} hint={f.hint} key={f.name}>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="aperçu"
            style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", marginBottom: 8, border: "1px solid var(--line-2)" }}
          />
        )}
        <input
          type="text"
          value={url}
          placeholder={f.placeholder || "URL de la photo ou téléverser →"}
          onChange={(e) => set(f.name, e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <ImageUpload onUploaded={(u) => set(f.name, u)} />
        </div>
      </Field>
    );
  }
  return (
    <Field label={f.label} hint={f.hint} key={f.name}>
      {f.type === "textarea" ? (
        <textarea
          value={(val as string) ?? ""}
          placeholder={f.placeholder}
          onChange={(e) => set(f.name, e.target.value)}
        />
      ) : f.type === "select" ? (
        <select value={(val as string) ?? ""} onChange={(e) => set(f.name, e.target.value)}>
          <option value="">— aucun —</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={f.type === "number" ? "number" : "text"}
          value={(val as string) ?? ""}
          placeholder={f.placeholder}
          onChange={(e) => set(f.name, e.target.value)}
        />
      )}
    </Field>
  );
}
