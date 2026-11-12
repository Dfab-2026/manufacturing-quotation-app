import { requireSession } from "@/lib/security/auth";
import { createCustomer } from "./actions";

export default async function CustomersPage() {
  const { supabase, membership } = await requireSession();
  const { data } = await supabase.from("customers").select("id,name,code,email,phone,gstin,active,contact_person,currency,payment_terms,default_margin_percent").eq("tenant_id", membership.tenant_id).order("name");
  return <>
    <div className="page-head"><div><h1>Customer master</h1><p>Commercial identities used by RFQs and quotations.</p></div></div>
    <div className="grid-2">
      <section className="card"><div className="card-head"><h2>Customers</h2></div>{(data??[]).length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Code</th><th>Contact</th><th>Status</th></tr></thead><tbody>{(data??[]).map(c=><tr key={c.id}><td><strong>{c.name}</strong><div className="help">{c.gstin || "GSTIN not set"}</div></td><td>{c.code || "—"}</td><td>{c.contact_person || c.email || c.phone || "—"}<div className="help">{c.currency || "INR"}{c.default_margin_percent != null ? ` · ${Number(c.default_margin_percent)}% margin` : ""}</div></td><td><span className={`badge badge-${c.active ? "ready" : "draft"}`}>{c.active ? "Active" : "Inactive"}</span></td></tr>)}</tbody></table></div> : <div className="empty"><strong>No customers</strong>Add the first customer to link RFQs and quotations.</div>}</section>
      <section className="card"><div className="card-head"><h2>Add customer</h2></div><form action={createCustomer} className="card-body form-grid">
        <div className="field field-full"><label htmlFor="name">Company name *</label><input className="input" id="name" name="name" required maxLength={160}/></div>
        <div className="field"><label htmlFor="code">Customer code</label><input className="input" id="code" name="code" maxLength={30}/></div>
        <div className="field"><label htmlFor="gstin">GSTIN / tax ID</label><input className="input" id="gstin" name="gstin" maxLength={20}/></div>
        <div className="field"><label htmlFor="contactPerson">Contact person</label><input className="input" id="contactPerson" name="contactPerson" maxLength={120}/></div>
        <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email"/></div>
        <div className="field"><label htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" maxLength={30}/></div>
        <div className="field"><label htmlFor="currency">Currency</label><select className="select" id="currency" name="currency" defaultValue="INR"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
        <div className="field"><label htmlFor="margin">Default margin %</label><input className="input" id="margin" name="margin" type="number" min="0" max="99.99" step="0.01"/></div>
        <div className="field"><label htmlFor="paymentTerms">Payment terms</label><input className="input" id="paymentTerms" name="paymentTerms" placeholder="30 days from invoice"/></div>
        <div className="field field-full"><label htmlFor="billingAddress">Billing address</label><textarea className="textarea" id="billingAddress" name="billingAddress"/></div>
        <div className="field field-full"><label htmlFor="shippingAddress">Shipping address</label><textarea className="textarea" id="shippingAddress" name="shippingAddress"/></div>
        <div className="field field-full"><button className="btn btn-primary" type="submit">Add customer</button></div>
      </form></section>
    </div>
  </>;
}
