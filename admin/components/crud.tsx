"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";
import { Modal, Field, Spinner, Empty, ConfirmDelete } from "./ui";

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select";

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
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);

  const load = async () => {
    try {
      setRows(await api.get<T[]>(endpoint));
    } catch (e) {
      toast((e as ApiError).message, "error");
      setRows([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

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
      const payload = buildPayload(fields, values);
      if (editing === "new") {
        await api.post(endpoint, payload);
        toast("Créé ✓", "ok");
      } else if (editing) {
        await api.patch(`${endpoint}/${editing.id}`, payload);
        toast("Enregistré ✓", "ok");
      }
      close();
      await load();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  };

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
        {canCreate && (
          <button className="btn btn-primary" onClick={openNew}>
            + Nouveau
          </button>
        )}
      </div>

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty label="Aucune entrée pour l'instant." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
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
