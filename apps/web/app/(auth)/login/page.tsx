import Link from "next/link";
import { signIn } from "./actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const errors: Record<string, string> = {
  "invalid-input": "Enter a valid email and a password of at least 8 characters.",
  "invalid-credentials": "The email or password is incorrect.",
  "no-membership": "Your account is not assigned to an active company workspace."
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : "";
  const next = typeof params.next === "string" ? params.next : "/dashboard";

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Product introduction">
        <div className="brand">
          <div className="brand-mark">FQ</div>
          <div className="brand-copy"><strong>ForgeQuote</strong><span>Manufacturing Intelligence</span></div>
        </div>
        <div>
          <h1>From engineering drawing to commercial quote.</h1>
          <p>Controlled extraction, deterministic costing, approval workflows and traceable quotation history for manufacturing teams.</p>
        </div>
        <p>Built for estimators, engineering teams and commercial leaders.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p>Use your company account to access your quotation workspace.</p>
          {errors[errorKey] && <div className="error" role="alert">{errors[errorKey]}</div>}
          {params.registered === "check-email" && <div className="error" role="status">Check your email to confirm the new account, then sign in.</div>}
          <form action={signIn} className="auth-form">
            <input type="hidden" name="next" value={next} />
            <div className="field field-full">
              <label htmlFor="email">Work email</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="field field-full">
              <label htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={8} required />
            </div>
            <button className="btn btn-primary" type="submit">Sign in securely</button>
          </form>
          <p style={{marginTop:18}}>New company? <Link href="/register"><strong>Create a workspace</strong></Link></p>
        </div>
      </section>
    </main>
  );
}
