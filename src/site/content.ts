import faviconUrl from "../../assets/favicon.png"
import hero1800 from "../../assets/hero-1800.webp"
import hero2_1600 from "../../assets/hero-2-1600.webp"
import hero2_480 from "../../assets/hero-2-480.webp"
import hero2_720 from "../../assets/hero-2-720.webp"
import hero2_960 from "../../assets/hero-2-960.webp"
import hero3_1600 from "../../assets/hero-3-1600.webp"
import hero3_480 from "../../assets/hero-3-480.webp"
import hero3_720 from "../../assets/hero-3-720.webp"
import hero3_960 from "../../assets/hero-3-960.webp"
import hero4_1600 from "../../assets/hero-4-1600.webp"
import hero4_480 from "../../assets/hero-4-480.webp"
import hero4_720 from "../../assets/hero-4-720.webp"
import hero4_960 from "../../assets/hero-4-960.webp"
import hero480 from "../../assets/hero-480.webp"
import hero720 from "../../assets/hero-720.webp"
import hero960 from "../../assets/hero-960.webp"
import logoUrl from "../../assets/shoe-logo.png"

const mailingListUrl =
  "https://lists.cornell.edu/GRAD-SWING-DANCE-L/subscribe"
const campusGroupsUrl = "https://cornell.campusgroups.com/gcss/club_signup"

export const siteContent = {
  brand: {
    name: "Swing Syndicate at Cornell",
    logoUrl,
    faviconUrl,
  },
  hero: {
    title: "Criminally Good Dancing.",
    description:
      "Free Lindy Hop every Monday night. No experience or partner required!",
    actions: [
      { label: "Get emails", href: mailingListUrl, variant: "default" },
      { label: "Join", href: campusGroupsUrl, variant: "outline" },
    ],
    slides: [
      {
        src: hero960,
        srcSet: `${hero480} 480w, ${hero720} 720w, ${hero960} 960w, ${hero1800} 1800w`,
        width: 1800,
        height: 1200,
        alt: "Swing dancers high-five while other couples dance around them",
      },
      {
        src: hero2_960,
        srcSet: `${hero2_480} 480w, ${hero2_720} 720w, ${hero2_960} 960w, ${hero2_1600} 1600w`,
        width: 1600,
        height: 1067,
        alt: "Two swing dancers step together while other couples fill the floor",
      },
      {
        src: hero3_960,
        srcSet: `${hero3_480} 480w, ${hero3_720} 720w, ${hero3_960} 960w, ${hero3_1600} 1600w`,
        width: 1600,
        height: 1067,
        alt: "Couples swing dance across a crowded wooden floor",
      },
      {
        src: hero4_960,
        srcSet: `${hero4_480} 480w, ${hero4_720} 720w, ${hero4_960} 960w, ${hero4_1600} 1600w`,
        width: 1600,
        height: 1067,
        alt: "Several couples practice swing dancing together in a warmly lit hall",
      },
    ],
  },
  schedule: {
    title: "Fall 2026 schedule",
    times: "Lesson 8–9 PM · Social dance 9–10 PM",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTMACS7bEK5TUm1wmzyu65DBGkbGSegPM8Vj5NqYywksSDJeSejUjTOmvFSbz_pQ70eMvOOH1SMW53G/pub?gid=0&single=true&output=csv",
  },
  specialEvents: {
    title: "Special Events",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTMACS7bEK5TUm1wmzyu65DBGkbGSegPM8Vj5NqYywksSDJeSejUjTOmvFSbz_pQ70eMvOOH1SMW53G/pub?gid=1922996257&single=true&output=csv",
  },
  etiquette: {
    title: "Dance etiquette",
    introduction:
      "Dancing is a joyful experience! We prioritize all dancers’ safety and comfort. Please review this guidance before participating in Swing Syndicate social dances.",
    sections: [
      {
        title: "Consent",
        items: [
          "Anyone may ask for a dance, regardless of their preferred dance role or gender identity.",
          "Anyone may decline a dance. No explanation is needed.",
          "Clearly ask a partner to dance, and respectfully accept if they do not wish to.",
          "Ask for clear consent before performing close-connection moves, such as Balboa or blues.",
        ],
      },
      {
        title: "Connection",
        items: [
          "Be considerate. Do not dance in ways that are painful or uncomfortable for your partner. If asked, respectfully adjust your connection style.",
          "You are free to stop dancing at any time. No one is obligated to dance an entire song.",
        ],
      },
      {
        title: "Floor craft",
        items: [
          "It is both dancers’ responsibility to prioritize safety. Be aware of your surroundings.",
          "Acknowledge and apologize if you or your partner run into someone.",
        ],
      },
      {
        title: "Hygiene",
        items: [
          "Come to Swing Syndicate events clean and scent-free. Be prepared to freshen up as needed.",
        ],
      },
      {
        title: "Dips, lifts, and aerials",
        items: [
          "Do not do aerials during Swing Syndicate events. Our dance floors are not safe for these moves.",
          "Do not do large lifts or jumps. Dancers performing risky moves will be asked to stop.",
          "Always ask your partner for consent before doing dips, small lifts, or small jumps.",
        ],
      },
    ],
    codeOfConductUrl:
      "https://policy.cornell.edu/policy-library/student-code-conduct",
  },
  faq: {
    title: "FAQ",
    items: [
      {
        question: "Do I need experience or a partner?",
        answer:
          "No. Our lessons are designed for dancers with no previous experience and we rotate partners throughout. Most people come by themselves.",
      },
      {
        question: "How much does it cost?",
        answer: "Nothing! Lessons and social dancing are free.",
      },
      {
        question: "Who can come?",
        answer:
          "Everyone. We're a graduate student organization, but our events are open to undergraduates, faculty, staff, and the Ithaca community.",
      },
      {
        question: "What should I wear?",
        answer:
          "Whatever you're comfortable moving in. We recommend flat shoes that you can turn in.",
      },
      {
        question: "Can I come for just part of the night?",
        answer: "Yes. Come for the lesson, the social dance, or both.",
      },
    ],
  },
  about: {
    title: "About",
    description:
      "We teach and promote swing dance to Cornell University students and community members. Our organization focuses on dances called swing dance—dances danced to swing jazz music—such as Lindy Hop, Charleston, Shag, Blues, and Balboa swing dances.",
    links: [
      { label: "CampusGroups", href: campusGroupsUrl },
      { label: "Instagram", href: "https://www.instagram.com/cornell_swing/" },
      { label: "Waiver", href: "https://cglink.me/2ee/s96437" },
      { label: "Mailing list", href: mailingListUrl },
      { label: "Email", href: "mailto:cugradswing@gmail.com" },
    ],
  },
  footer:
    "Swing Syndicate is a registered student organization of Cornell University.",
} as const
