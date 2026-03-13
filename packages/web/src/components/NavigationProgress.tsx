import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

/**
 * NProgress-style top loading bar that appears during React Router navigations.
 *
 * Uses useNavigation() to detect route transitions. When a transition starts,
 * a thin bar grows across the top of the screen. When navigation completes,
 * it snaps to 100% and fades out.
 */
export function NavigationProgress() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (isLoading) {
      // Show the bar and begin indeterminate progress animation
      setVisible(true);
      setProgress(8);

      intervalRef.current = setInterval(() => {
        setProgress((prev) => {
          // Slow asymptotic approach to 90% — never reaches 100% until done
          if (prev >= 90) return prev;
          const increment = (90 - prev) * 0.12;
          return prev + Math.max(increment, 0.5);
        });
      }, 120);
    } else {
      // Navigation done: snap to 100%, then fade out
      clearInterval(intervalRef.current);
      setProgress(100);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 350);
    }

    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(hideTimerRef.current);
    };
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      className="fixed left-0 top-0 z-[9999] h-0.5 bg-primary transition-all duration-200 ease-out"
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-label="Page loading"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-hidden="true"
    />
  );
}
