import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import Preloader from "./components/Preloader";
import Cursor from "./components/Cursor";
import EmberField from "./components/EmberField";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Marquee from "./components/Marquee";
import Manifesto from "./components/Manifesto";
import Showcase from "./components/Showcase";
import Architecture from "./components/Architecture";
import Craft from "./components/Craft";
import HallOfFame from "./components/HallOfFame";
import GetAsheo from "./components/GetAsheo";
import Footer from "./components/Footer";

export default function App() {
  const [loading, setLoading] = useState(true);
  const done = useCallback(() => setLoading(false), []);

  useEffect(() => {
    document.body.style.overflow = loading ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [loading]);

  // safety: never trap the user behind the preloader
  useEffect(() => {
    const id = window.setTimeout(() => setLoading(false), 6000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="relative min-h-screen bg-abyss text-bone">
      <AnimatePresence>{loading && <Preloader onDone={done} />}</AnimatePresence>

      <Cursor />
      <EmberField />
      <div className="noise-overlay" aria-hidden="true" />

      <Nav />
      <main className="relative z-10">
        <Hero ready={!loading} />
        <Marquee
          items={[
            "Custom payment gateways",
            "BIN tools",
            "Integrity checks",
            "Checkout autopilot",
            "MV3 extension",
          ]}
        />
        <Manifesto />
        <Showcase />
        <Architecture />
        <Craft />
        <HallOfFame />
        <GetAsheo />
      </main>
      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
