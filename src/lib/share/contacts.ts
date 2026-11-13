import type { ClientPhone, ContactPerson } from '../types'
import type { DocumentActionContact } from '../../components/share/DocumentActionDialog'

const PHONE_LABEL: Record<ClientPhone['label'], string> = {
  mobile: 'Mobile',
  office: 'Office',
  whatsapp: 'WhatsApp',
}

/**
 * Maps a client / fill-client's stored phones to dialog contacts, e.g.
 * { label: 'Ahmad · Mobile', phone: '+961 70 000003' } (the client's name is
 * prefixed when given, since stored phones carry no name). Active numbers come first;
 * deactivated ones stay selectable but are marked "(inactive)". Blank
 * numbers are dropped and duplicates collapsed.
 */
export function clientPhoneContacts(
  phones: ReadonlyArray<Pick<ClientPhone, 'number' | 'label' | 'isActive'>> | null | undefined,
  clientName?: string | null,
): DocumentActionContact[] {
  const name = clientName?.trim()
  const seen = new Set<string>()
  const rows = (phones ?? [])
    .filter((p) => p.number?.trim())
    .filter((p) => (seen.has(p.number.trim()) ? false : (seen.add(p.number.trim()), true)))
    .map((p) => ({
      active: p.isActive !== false,
      contact: {
        label: `${name ? `${name} · ` : ''}${PHONE_LABEL[p.label] ?? 'Phone'}${p.isActive === false ? ' (inactive)' : ''}`,
        phone: p.number.trim(),
      },
    }))
  return [...rows.filter((r) => r.active), ...rows.filter((r) => !r.active)].map((r) => r.contact)
}

/** Maps a supplier's contact persons to dialog contacts, labelled with the person's name (and role). */
export function supplierContacts(
  people: ReadonlyArray<Pick<ContactPerson, 'name' | 'phone' | 'role'>> | null | undefined,
): DocumentActionContact[] {
  return (people ?? [])
    .filter((c) => c.phone?.trim())
    .map((c) => ({ label: [c.name, c.role].filter(Boolean).join(' · ') || 'Contact', phone: c.phone.trim() }))
}
