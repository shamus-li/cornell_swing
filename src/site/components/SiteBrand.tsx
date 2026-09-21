import { siteContent } from "../content"

export function SiteBrand() {
  return <a className="site-name" href="/">
    <img src={siteContent.brand.logoUrl} alt="" width="52" height="128" />
    <span>{siteContent.brand.name}</span>
  </a>
}
