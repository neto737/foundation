import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").optional(),
  name: z.string().trim().min(1, "Enter your name").optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .optional(),
});

export type FormValues = z.infer<typeof formSchema>;

export type Feedback = {
  kind: "error" | "success";
  message: string;
};

export function AsyncForm(props: {
  action: (data: FormValues) => Promise<Feedback>;
  alternativeAction?: ReactNode;
  children: ReactNode;
  pendingLabel: string;
  submitLabel: string;
  title: string;
  requiredFields: Array<keyof FormValues>;
}) {
  const feedbackId = useId();
  const [feedback, setFeedback] = useState<Feedback>();
  const schema = formSchema.superRefine((values, context) => {
    for (const name of props.requiredFields) {
      if (!values[name])
        context.addIssue({
          code: "custom",
          path: [name],
          message: `Enter your ${name}`,
        });
    }
  });
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const pending = form.formState.isSubmitting;

  async function submit(data: FormValues) {
    try {
      setFeedback(await props.action(data));
    } catch {
      setFeedback({
        kind: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  }

  function validate(event: FormEvent<HTMLFormElement>) {
    setFeedback(undefined);
    void form.handleSubmit(submit)(event);
  }

  return (
    <FormProvider {...form}>
      <form
        noValidate
        aria-busy={pending}
        aria-describedby={feedback ? feedbackId : undefined}
        onSubmit={validate}
      >
        <h2>{props.title}</h2>
        {props.children}
        <button type="submit" disabled={pending}>
          {pending ? props.pendingLabel : props.submitLabel}
        </button>
        <p
          className="form-message"
          id={feedbackId}
          role={feedback?.kind === "error" ? "alert" : "status"}
          aria-live={feedback?.kind === "error" ? "assertive" : "polite"}
        >
          {feedback?.message}
        </p>
        {props.alternativeAction}
      </form>
    </FormProvider>
  );
}

export function FormField(props: {
  autoComplete: string;
  label: string;
  minLength?: number;
  name: keyof FormValues;
  type?: "email" | "password" | "text";
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const error = errors[props.name];

  return (
    <>
      <label htmlFor={inputId}>
        {props.label}
        <input
          {...register(props.name)}
          id={inputId}
          required
          minLength={props.minLength}
          type={props.type}
          autoComplete={props.autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error.message}
        </span>
      ) : null}
    </>
  );
}
