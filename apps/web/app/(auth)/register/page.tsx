import Link from "next/link";
import { registerCompany } from "./actions";

type Props = { searchParams: Promise<Record<string,string|string[]|undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="brand">
          <div className="brand-mark">FQ</div>
          <div className="brand-copy"><strong>ForgeQuote</strong><span>Manufacturing Intelligence</span></div>
        </div>
        <div>
          <h1>Create a controlled quotation workspace.</h1>
          <p>Your company receives an isolated tenant, private drawing storage and owner-level administration from the first account.</p>
        </div>
        <p>Company data is isolated at the database policy layer.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Create company workspace</h2>
          <p>Start with the account that will own company administration.</p>
          {params.error && <div className="error" role="alert">Registration could not be completed. Check the fields or try another email.</div>}
          <form action={registerCompany} className="auth-form">
            <div className="field field-full"><label htmlFor="company">Company name</label><input className="input" id="company" name="company" minLength={2} maxLength={160} required /></div>
            <div className="field field-full"><label htmlFor="fullName">Your name</label><input className="input" id="fullName" name="fullName" minLength={2} maxLength={120} required /></div>
            <div className="field field-full"><label htmlFor="email">Work email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
            <div className="field field-full"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /><span className="help">Use at least 10 characters. MFA should be enabled for owner/admin accounts in production.</span></div>
            <button className="btn btn-primary" type="submit">Create workspace</button>
          </form>
          <p style={{marginTop:18}}>Already registered? <Link href="/login"><strong>Sign in</strong></Link></p>
        </div>
      </section>
    </main>
  );
}
