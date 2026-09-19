import { motion } from 'framer-motion';

// Thin wrapper so every route gets the same fade/rise transition without
// editing each page component's own JSX — the page itself renders exactly
// as before, just inside a transform layer AnimatePresence can animate out
// on route change. Duration/ease match --base/--ease in index.css, so this
// reads as the same motion language as the CSS-driven micro animations
// already used throughout (fade-slide-up etc.), not a separate system.
const variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export default function PageTransition({ children }) {
  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
