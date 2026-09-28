import type { Contact } from '@crm/shared';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TD, TH, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';

export const metadata: Metadata = { title: 'Contacts' };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  const contacts = await api<Contact[]>(
    `/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
  );

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${contacts.length} people`}
        actions={
          <form className="relative w-64">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              name="search"
              defaultValue={search}
              placeholder="Search contacts…"
              className="pl-8"
            />
          </form>
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Title</TH>
              <TH>Company</TH>
              <TH>Email</TH>
              <TH>Phone</TH>
            </tr>
          </THead>
          <tbody>
            {contacts.map((c) => (
              <TRow key={c.id} className="hover:bg-muted/40">
                <TD className="font-medium">
                  {c.firstName} {c.lastName}
                </TD>
                <TD className="text-muted-foreground">{c.title ?? '—'}</TD>
                <TD>
                  <Link href={`/companies/${c.company.id}`} className="hover:underline">
                    {c.company.name}
                  </Link>
                </TD>
                <TD>
                  <a href={`mailto:${c.email}`} className="text-muted-foreground hover:underline">
                    {c.email}
                  </a>
                </TD>
                <TD className="text-muted-foreground whitespace-nowrap">{c.phone ?? '—'}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
