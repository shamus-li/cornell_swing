import { HeroCarousel } from "./components/HeroCarousel"
import { Schedule, SpecialEvents, useScheduleData } from "./components/Schedule"
import { siteContent } from "./content"

export default function App() {
  const { schedule, specialEvents } = useScheduleData(
    siteContent.schedule.url,
    siteContent.specialEvents.url,
  )

  return (
    <div>
      <header className="site-header">
        <a className="site-name" href="/">
          <img
            src={siteContent.brand.logoUrl}
            alt=""
            width="52"
            height="128"
          />
          <span>{siteContent.brand.name}</span>
        </a>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title">{siteContent.hero.title}</h1>
          <p>{siteContent.hero.description}</p>
          <div className="hero-links">
            {siteContent.hero.actions.map((action) => (
              <a
                key={action.label}
                className="button"
                data-slot="button"
                data-variant={action.variant}
                data-size="default"
                href={action.href}
              >
                {action.label}
              </a>
            ))}
          </div>
          <HeroCarousel />
        </section>

        <Schedule
          title={siteContent.schedule.title}
          times={siteContent.schedule.times}
          {...schedule}
        />
        <SpecialEvents title={siteContent.specialEvents.title} {...specialEvents} />

        <section
          id="etiquette"
          className="section etiquette"
          aria-labelledby="etiquette-title"
        >
          <h2 id="etiquette-title">{siteContent.etiquette.title}</h2>
          <p className="etiquette-intro">
            {siteContent.etiquette.introduction}
          </p>

          {siteContent.etiquette.sections.map((section) => (
            <div className="etiquette-item" key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}

          <p className="etiquette-contact">
            Our events also follow the{" "}
            <a href={siteContent.etiquette.codeOfConductUrl}>
              Cornell Student Code of Conduct
            </a>
            .
          </p>
        </section>

        <section id="faq" className="section faq" aria-labelledby="faq-title">
          <h2 id="faq-title">{siteContent.faq.title}</h2>
          {siteContent.faq.items.map((item) => (
            <div className="faq-item" key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          ))}
        </section>

        <section
          id="about"
          className="section about"
          aria-labelledby="about-title"
        >
          <h2 id="about-title">{siteContent.about.title}</h2>
          <p>{siteContent.about.description}</p>
          <p className="about-links">
            {siteContent.about.links.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <p>{siteContent.footer}</p>
      </footer>
    </div>
  )
}
