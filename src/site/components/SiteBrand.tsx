import logoUrl from "../../../assets/shoe-logo.png"

// The check-in kiosk shows the brand without a link, so nobody can tap away from check-in.
export function SiteBrand({ link = true }: { link?: boolean }) {
  const content = <>
    <img src={logoUrl} alt="" width="52" height="128" />
    <span>Swing Syndicate at Cornell</span>
  </>
  return link ? <a className="site-name" href="/">{content}</a> : <span className="site-name">{content}</span>
}
