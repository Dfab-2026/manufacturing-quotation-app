"use client";

import { useEffect, useRef, useState } from "react";
import type { FormHTMLAttributes, ReactNode } from "react";

type Props = Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  delay?: number;
};

/** Saves valid field edits without requiring a separate Save click. */
export function AutoSaveForm({ action, children, delay = 850, ...props }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const submitValid = () => {
    clearTimer();
    if (dirty && form.current?.checkValidity()) {
      form.current.requestSubmit();
      setDirty(false);
    }
  };

  useEffect(() => () => clearTimer(), []);

  return (
    <form
      {...props}
      ref={form}
      action={action}
      onChange={(event) => {
        props.onChange?.(event);
        setDirty(true);
        clearTimer();
        timer.current = setTimeout(() => {
          if (form.current?.checkValidity()) {
            form.current.requestSubmit();
            setDirty(false);
          }
        }, delay);
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        // Wait until the next focus change to avoid submitting intermediate input.
        if (dirty) {
          clearTimer();
          timer.current = setTimeout(submitValid, 250);
        }
      }}
      onSubmit={(event) => {
        props.onSubmit?.(event);
        clearTimer();
      }}
    >
      {children}
    </form>
  );
}
