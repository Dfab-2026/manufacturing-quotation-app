import type { Metadata } from "next";
import "./globals.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
export const metadata: Metadata = { title:"AI Manufacturing Quotation", description:"Drawing to quotation" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
