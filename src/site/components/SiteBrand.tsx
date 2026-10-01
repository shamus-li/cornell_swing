import logoUrl from "../../../assets/shoe-logo.png"

export function SiteBrand() {
  return <a className="site-name" href="/">
    <img src={logoUrl} alt="" width="52" height="128" />
    <span>Swing Syndicate at Cornell</span>
  </a>
}
