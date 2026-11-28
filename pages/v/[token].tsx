import type { GetServerSideProps, GetServerSidePropsContext } from 'next'
import Head from 'next/head'
import { getServiceRoleClient } from '@/lib/supabase-server'
import {
  resolveShareLink,
  type ClientDocumentPayload,
  type ShareLinkStatus,
} from '@/lib/share-server'
import { formatCents } from '@/lib/money'

/**
 * Public client-facing document viewer (C10).
 *
 * Requirements:
 *   - Fast and legible on a bad LTE connection.
 *   - Zero client-side JavaScript shipped (`unstable_runtimeJS: false`).
 *   - Constant-time token lookup via database hash.
 *   - Inactive (expired/revoked) links show polite contact page instead of 404/crash.
 *   - Zero app chrome, zero login prompts, zero internal margins/costs.
 */
export const config = {
  unstable_runtimeJS: false,
}

interface InactiveProps {
  active: false
  status: ShareLinkStatus
  contractor: {
    name: string
    phone: string | null
    email: string | null
  } | null
}

interface ActiveProps {
  active: true
  document: ClientDocumentPayload
}

type PageProps = InactiveProps | ActiveProps

export const getServerSideProps: GetServerSideProps<PageProps> = async (
  context: GetServerSidePropsContext,
) => {
  const token = typeof context.params?.token === 'string' ? context.params.token : ''
  if (!token) {
    return {
      props: {
        active: false,
        status: 'not_found',
        contractor: null,
      },
    }
  }

  const forwarded = context.req.headers['x-forwarded-for']
  const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null
  const ip = forwardedIp || context.req.socket?.remoteAddress || null
  const userAgent = context.req.headers['user-agent'] ?? null
  const referer = context.req.headers['referer'] ?? null

  const result = await resolveShareLink(getServiceRoleClient(), token, {
    ip,
    userAgent,
    referer,
  })

  if (!result.ok) {
    return {
      props: {
        active: false,
        status: result.status,
        contractor: result.contractor ?? null,
      },
    }
  }

  return {
    props: {
      active: true,
      document: result.document,
    },
  }
}

export default function ClientDocumentView(props: PageProps) {
  if (!props.active) {
    const { status, contractor } = props
    const heading =
      status === 'revoked'
        ? 'This link has been updated or revoked'
        : status === 'expired'
          ? 'This link has expired'
          : 'This link is no longer active'

    return (
      <div className="share-view-wrapper">
        <Head>
          <title>{heading} — PaperTrail</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <main className="share-inactive-card">
          <div className="share-inactive-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1>{heading}</h1>
          <p className="share-inactive-msg">
            The document you are trying to view is no longer available at this address.
            {contractor ? ` Please reach out to ${contractor.name} directly for an updated link or copy.` : ' Please contact your contractor directly.'}
          </p>
          {contractor && (
            <div className="share-contact-box">
              <h2>{contractor.name}</h2>
              {contractor.phone && (
                <p>
                  <strong>Phone:</strong>{' '}
                  <a href={`tel:${contractor.phone.replace(/[^0-9+]/g, '')}`}>{contractor.phone}</a>
                </p>
              )}
              {contractor.email && (
                <p>
                  <strong>Email:</strong>{' '}
                  <a href={`mailto:${contractor.email}`}>{contractor.email}</a>
                </p>
              )}
            </div>
          )}
        </main>
      </div>
    )
  }

  const { document } = props
  const pdfDownloadUrl = `/api/v/${document.rawToken}/pdf`

  return (
    <div className="share-view-wrapper">
      <Head>
        <title>
          {document.documentTitle} {document.documentNumber} — {document.letterhead.companyName}
        </title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Top action bar */}
      <header className="share-top-bar">
        <div className="share-top-bar-inner">
          <span className="share-top-contractor">{document.letterhead.companyName}</span>
          <a href={pdfDownloadUrl} download className="btn-download-pdf">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download PDF
          </a>
        </div>
      </header>

      {/* Document Sheet */}
      <main className="share-document-sheet">
        {/* Letterhead & Metadata */}
        <section className="share-header-grid">
          <div className="share-company-info">
            <h1 className="share-company-name">{document.letterhead.companyName}</h1>
            {document.letterhead.dba && <p className="share-dba">dba {document.letterhead.dba}</p>}
            <div className="share-address-block">
              {document.letterhead.addressLines.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
            {(document.letterhead.phone || document.letterhead.email) && (
              <div className="share-company-contact">
                {document.letterhead.phone && <div>Tel: <a href={`tel:${document.letterhead.phone.replace(/[^0-9+]/g, '')}`}>{document.letterhead.phone}</a></div>}
                {document.letterhead.email && <div>Email: <a href={`mailto:${document.letterhead.email}`}>{document.letterhead.email}</a></div>}
              </div>
            )}
            {(document.letterhead.licenseNumber || document.letterhead.insuranceCarrier) && (
              <div className="share-credentials">
                {document.letterhead.licenseNumber && <div>Lic: {document.letterhead.licenseNumber}</div>}
                {document.letterhead.insuranceCarrier && (
                  <div>Insured: {document.letterhead.insuranceCarrier}{document.letterhead.insurancePolicy ? ` (${document.letterhead.insurancePolicy})` : ''}</div>
                )}
              </div>
            )}
          </div>

          <div className="share-meta-box">
            <div className="share-doc-badge">{document.documentTitle}</div>
            <div className="share-doc-num">{document.documentNumber}</div>
            {document.projectTitle && <div className="share-project-title">Project: <strong>{document.projectTitle}</strong></div>}
            <dl className="share-dates">
              <div>
                <dt>Issued:</dt>
                <dd>{new Date(document.issuedAt).toLocaleDateString()}</dd>
              </div>
              {document.expiresAt && (
                <div>
                  <dt>Valid Through:</dt>
                  <dd>{new Date(document.expiresAt).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        <hr className="share-divider" />

        {/* Client & Property Blocks */}
        <section className="share-parties-grid">
          <div className="share-party-card">
            <h3>{document.client.heading}</h3>
            {document.client.lines.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
          <div className="share-party-card">
            <h3>{document.property.heading}</h3>
            {document.property.lines.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </section>

        {/* Line Items */}
        <section className="share-items-section">
          {document.detailLevel === 'summary' ? (
            <table className="share-table">
              <thead>
                <tr>
                  <th scope="col">Scope Group</th>
                  <th scope="col" className="text-right">Items</th>
                  <th scope="col" className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {document.groups.map((group, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>{group.label}</strong>
                      {group.optionalCents > 0 && (
                        <span className="share-optional-note"> ({formatCents(group.optionalCents)} optional)</span>
                      )}
                    </td>
                    <td className="text-right">{group.lineCount}</td>
                    <td className="text-right">{formatCents(group.subtotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="share-table-wrapper">
              <table className="share-table">
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col" className="text-right">Qty</th>
                    <th scope="col">Unit</th>
                    <th scope="col" className="text-right">Unit Price</th>
                    <th scope="col" className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {document.lines.map((line, idx) => (
                    <tr key={idx} className={line.isOptional ? 'row-optional' : ''}>
                      <td>
                        <div className="share-line-desc">
                          {line.description}
                          {line.isOptional && <span className="share-badge-opt">Optional</span>}
                        </div>
                        {line.derivation && (
                          <div className="share-line-deriv">{line.derivation}</div>
                        )}
                        {line.groupLabel && (
                          <div className="share-line-group">{line.groupLabel}</div>
                        )}
                      </td>
                      <td className="text-right">{line.quantity}</td>
                      <td>{line.unit}</td>
                      <td className="text-right">{formatCents(line.unitPriceCents)}</td>
                      <td className="text-right">
                        {line.isOptional ? `(${formatCents(line.amountCents)})` : formatCents(line.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Totals Breakdown */}
        <section className="share-totals-section">
          <dl className="share-totals-list">
            {document.totals.map((tot, idx) => (
              <div key={idx} className={tot.emphasis ? 'share-total-emphasis' : ''}>
                <dt>{tot.label}</dt>
                <dd>{formatCents(tot.amountCents)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Terms & Client Notes */}
        {(document.notesToClient || document.terms) && (
          <section className="share-notes-section">
            {document.notesToClient && (
              <div className="share-note-block">
                <h3>Notes from Contractor</h3>
                <p>{document.notesToClient}</p>
              </div>
            )}
            {document.terms && (
              <div className="share-terms-block">
                <h3>Terms &amp; Conditions</h3>
                <p>{document.terms}</p>
              </div>
            )}
          </section>
        )}

        {/* Footer contact */}
        <footer className="share-footer">
          <p>
            Questions about this {document.documentTitle.toLowerCase()}? Contact{' '}
            <strong>{document.letterhead.companyName}</strong>
            {document.letterhead.phone && <> at <a href={`tel:${document.letterhead.phone.replace(/[^0-9+]/g, '')}`}>{document.letterhead.phone}</a></>}
            {document.letterhead.email && <> or <a href={`mailto:${document.letterhead.email}`}>{document.letterhead.email}</a></>}.
          </p>
        </footer>
      </main>
    </div>
  )
}
