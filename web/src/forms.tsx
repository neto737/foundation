import { useId, useState, type FormEvent } from "react";
import type { ProvisionInput } from "./api.js";

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  max?: number;
  value?: string | undefined;
};
type Values = Record<string, string>;
function Form({
  fields,
  submit,
  busy,
  label,
  onSubmit,
  validate,
}: {
  fields: Field[];
  submit: string;
  busy: boolean;
  label: string;
  onSubmit(values: Values): Promise<void>;
  validate(values: Values): Values;
}) {
  const id = useId();
  const [errors, setErrors] = useState<Values>({});
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = Object.fromEntries(
      fields.map((field) => [field.name, String(data.get(field.name) ?? "")]),
    );
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const firstInvalid = form.elements.namedItem(Object.keys(nextErrors)[0]!);
      if (firstInvalid instanceof HTMLInputElement) firstInvalid.focus();
      return;
    }
    await onSubmit(values);
    for (const element of Array.from(form.elements)) {
      if (element instanceof HTMLInputElement && element.type === "password")
        element.value = "";
    }
  }
  return (
    <form
      onSubmit={(event) => void handle(event)}
      noValidate
      aria-label={label}
    >
      <fieldset disabled={busy}>
        <legend className="sr-only">{label}</legend>
        {fields.map((field) => (
          <div className="field" key={field.name}>
            <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
            {field.hint && (
              <p className="hint" id={`${id}-${field.name}-hint`}>
                {field.hint}
              </p>
            )}
            <input
              id={`${id}-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              autoComplete={field.autoComplete}
              required
              maxLength={field.max ?? 160}
              defaultValue={field.value ?? ""}
              aria-invalid={Boolean(errors[field.name])}
              aria-describedby={
                [
                  field.hint && `${id}-${field.name}-hint`,
                  errors[field.name] && `${id}-${field.name}-error`,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            {errors[field.name] && (
              <p className="field-error" id={`${id}-${field.name}-error`}>
                {errors[field.name]}
              </p>
            )}
          </div>
        ))}
        {Object.keys(errors).length > 0 && (
          <p className="sr-only" role="alert">
            Confira os campos indicados antes de continuar.
          </p>
        )}
        <button className="primary" type="submit">
          {busy ? "Aguarde…" : submit}
        </button>
      </fieldset>
    </form>
  );
}

export function AccessForm({
  mode,
  busy,
  onSubmit,
  initial,
}: {
  mode: "email" | "login" | "password" | "organization";
  busy: boolean;
  initial?: ProvisionInput | undefined;
  onSubmit(values: Values): Promise<void>;
}) {
  if (mode === "organization")
    return (
      <Form
        busy={busy}
        label="Criar organização"
        submit="Criar organização e primeira igreja"
        fields={[
          {
            name: "organizationName",
            label: "Nome da organização",
            hint: "A organização reúne as igrejas que você administra.",
            value: initial?.organizationName,
          },
          {
            name: "churchName",
            label: "Nome da primeira igreja",
            value: initial?.churchName,
          },
        ]}
        validate={(values) =>
          Object.fromEntries(
            ["organizationName", "churchName"]
              .filter((key) => !values[key]?.trim())
              .map((key) => [key, "Informe um nome para continuar."]),
          )
        }
        onSubmit={onSubmit}
      />
    );
  if (mode === "password")
    return (
      <Form
        busy={busy}
        label="Definir senha"
        submit="Salvar minha senha"
        fields={[
          {
            name: "newPassword",
            label: "Nova senha",
            type: "password",
            autoComplete: "new-password",
            hint: "Use de 8 a 128 caracteres. Escolha uma senha que você não usa em outros serviços.",
            max: 128,
          },
          {
            name: "confirmation",
            label: "Confirme a nova senha",
            type: "password",
            autoComplete: "new-password",
            max: 128,
          },
        ]}
        validate={(values) => {
          const errors: Values = {};
          if (
            (values.newPassword?.length ?? 0) < 8 ||
            (values.newPassword?.length ?? 0) > 128
          )
            errors.newPassword = "Use de 8 a 128 caracteres.";
          if (
            !values.confirmation ||
            values.confirmation !== values.newPassword
          )
            errors.confirmation = "As senhas precisam ser iguais.";
          return errors;
        }}
        onSubmit={onSubmit}
      />
    );
  const fields: Field[] = [
    {
      name: "email",
      label: "Seu e-mail",
      type: "email",
      autoComplete: "email",
      max: 254,
    },
  ];
  if (mode === "login")
    fields.push({
      name: "password",
      label: "Sua senha",
      type: "password",
      autoComplete: "current-password",
      max: 128,
    });
  return (
    <Form
      busy={busy}
      fields={fields}
      label={mode === "login" ? "Entrar na conta" : "Começar com e-mail"}
      submit={mode === "login" ? "Entrar" : "Receber link de acesso"}
      validate={(values) => {
        const errors: Values = {};
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email?.trim() ?? ""))
          errors.email = "Informe um e-mail válido.";
        if (mode === "login" && !values.password)
          errors.password = "Informe sua senha.";
        return errors;
      }}
      onSubmit={onSubmit}
    />
  );
}
