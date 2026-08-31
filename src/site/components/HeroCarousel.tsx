import { useCallback, useEffect, useRef, useState } from "react"

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "../../components/ui/carousel"
import { siteContent } from "../content"

const AUTOPLAY_DELAY = 6000
const imageSizes =
  "(max-width: 632px) calc(100vw - 32px), (max-width: 760px) 600px, (max-width: 960px) calc(100vw - 40px), 920px"

export function HeroCarousel() {
  const firstImage = useRef<HTMLImageElement>(null)
  const [loadImages, setLoadImages] = useState(() =>
    siteContent.hero.slides.map((_, index) => index === 0),
  )
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const [restart, setRestart] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  const requestImages = useCallback((...indices: number[]) => {
    setLoadImages((current) => {
      if (indices.every((index) => current[index])) return current
      const next = [...current]
      for (const index of indices) next[index] = true
      return next
    })
  }, [])

  useEffect(() => {
    const image = firstImage.current!
    const loadNext = () => requestImages(1)

    // Native lazy loading also fetches nearby horizontal slides. Keep their
    // requests out of the first photo's loading path, including before hydration.
    if (image.complete) loadNext()
    image.addEventListener("load", loadNext)
    image.addEventListener("error", loadNext)
    return () => {
      image.removeEventListener("load", loadNext)
      image.removeEventListener("error", loadNext)
    }
  }, [requestImages])

  useEffect(() => {
    if (!api) return

    const updateSelection = () => {
      const slideCount = api.scrollSnapList().length
      const selected = api.selectedScrollSnap()
      setCount(slideCount)
      setCurrent(selected)
    }
    const updateSelectionAndLoadNext = () => {
      updateSelection()
      const slideCount = api.scrollSnapList().length
      requestImages(api.selectedScrollSnap(), (api.selectedScrollSnap() + 1) % slideCount)
    }

    updateSelection()
    api.on("select", updateSelectionAndLoadNext)
    api.on("reInit", updateSelection)

    return () => {
      api.off("select", updateSelectionAndLoadNext)
      api.off("reInit", updateSelection)
    }
  }, [api, requestImages])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setReduceMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener("change", updatePreference)
    return () => mediaQuery.removeEventListener("change", updatePreference)
  }, [])

  useEffect(() => {
    if (!api || count < 2 || reduceMotion) return

    let timer: number | undefined
    const onVisibilityChange = () => {
      window.clearTimeout(timer)
      if (!document.hidden) setRestart((value) => value + 1)
    }

    if (!document.hidden) {
      timer = window.setTimeout(() => {
        if (!document.hidden) api.scrollNext()
      }, AUTOPLAY_DELAY)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [api, count, current, reduceMotion, restart])

  const selectSlide = (index: number) => {
    setRestart((value) => value + 1)
    requestImages(index)
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
                ref={index === 0 ? firstImage : undefined}
                src={loadImages[index] ? slide.src : undefined}
                srcSet={loadImages[index] ? slide.srcSet : undefined}
                sizes={imageSizes}
                alt={slide.alt}
                width={slide.width}
                height={slide.height}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "low"}
                decoding={index === 0 ? "sync" : "async"}
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
