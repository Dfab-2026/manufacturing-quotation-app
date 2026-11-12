"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  company: z.string().trim().min(2).max(160),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(128)
});

export async function registerCompany(formData: FormData) {
  const parsed = schema.safeParse({
    company: formData.get("company"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (!parsed.success) redirect("/register?error=invalid-input");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        company_name: parsed.data.company,
        full_name: parsed.data.fullName
      }
    }
  });

  if (error) redirect("/register?error=registration-failed");
  if (data.session) redirect("/dashboard");
  redirect("/login?registered=check-email");
}
