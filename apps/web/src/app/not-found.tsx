import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <p className="text-muted-foreground text-sm">404</p>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">This record does not exist in your workspace.</p>
      <Link href="/" className="text-ai mt-2 text-sm hover:underline">
        Back to overview
      </Link>
    </main>
  );
}
