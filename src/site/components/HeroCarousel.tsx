import { useEffect, useState } from "react"

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "../../components/ui/carousel"
import { siteContent } from "../content"

const AUTOPLAY_DELAY = 6000
const imageSizes =
  "(max-width: 700px) calc(100vw - 32px), (max-width: 960px) calc(100vw - 40px), 920px"

export function HeroCarousel() {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const [restart, setRestart] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    if (!api) return

    const updateSelection = () => {
      setCount(api.scrollSnapList().length)
      setCurrent(api.selectedScrollSnap())
    }

    updateSelection()
    api.on("select", updateSelection)
    api.on("reInit", updateSelection)

    return () => {
      api.off("select", updateSelection)
      api.off("reInit", updateSelection)
    }
  }, [api])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setReduceMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener("change", updatePreference)
    return () => mediaQuery.removeEventListener("change", updatePreference)
  }, [])

  useEffect(() => {
    if (!api || count < 2 || reduceMotion) return

    const timer = window.setTimeout(() => {
      api.scrollNext()
    }, AUTOPLAY_DELAY)

    return () => window.clearTimeout(timer)
  }, [api, count, current, reduceMotion, restart])

  const selectSlide = (index: number) => {
    setRestart((value) => value + 1)
    api?.scrollTo(index)
  }

  return (
    <div className="hero-carousel-root">
      <Carousel
        setApi={setApi}
        opts={{ loop: true }}
        className="hero-carousel"
        aria-label="Swing dance photos"
      >
        <CarouselContent>
          {siteContent.hero.slides.map((slide, index) => (
            <CarouselItem
              key={slide.src}
              aria-label={`${index + 1} of ${siteContent.hero.slides.length}`}
            >
              <img
                src={slide.src}
                srcSet={slide.srcSet}
                sizes={imageSizes}
                alt={slide.alt}
                width={slide.width}
                height={slide.height}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                decoding="async"
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        <div
          className="hero-carousel-dots"
          role="group"
          aria-label="Choose a photo"
        >
          {Array.from({ length: count }).map((_, index) => {
            const active = index === current

            return (
              <button
                key={index}
                type="button"
                className="hero-carousel-dot"
                data-active={active || undefined}
                onClick={() => selectSlide(index)}
                aria-label={`Go to photo ${index + 1}`}
                aria-current={active ? "true" : undefined}
              >
                <span className="hero-carousel-dot-track">
                  {active && (
                    <span
                      key={`${current}-${restart}`}
                      className="hero-carousel-dot-progress"
                    />
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </Carousel>
    </div>
  )
}
