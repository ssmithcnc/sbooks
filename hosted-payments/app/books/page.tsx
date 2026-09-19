import Books from "./viewer";

export const metadata = { title: "S-Books Online" };

export default function BooksPage() {
  return <Books url={process.env.NEXT_PUBLIC_SUPABASE_URL || ""}
    apiKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""} />;
}
