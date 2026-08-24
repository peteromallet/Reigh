import { useCallback, useEffect, useRef, useState } from 'react';
import { useTravelAutoAdvance } from '../../motion/useTravelAutoAdvance';
import { safePlay } from '@/shared/lib/media/safePlay';

interface ExampleStyle {
  prompt: string;
  image1: string;
  image2: string;
  video: string;
}

interface TravelExample {
  id: string;
  label: string;
  images: string[];
  video: string;
  poster: string;
}

interface UsePhilosophyPaneMediaInput {
  isOpen: boolean;
  isClosing: boolean;
  isOpening: boolean;
  currentExample: ExampleStyle;
  travelExamples: TravelExample[];
}

interface UsePhilosophyPaneMediaResult {
  philosophyVideoRef: React.RefObject<HTMLVideoElement | null>;
  travelVideoRefs: React.MutableRefObject<Array<HTMLVideoElement | null>>;
  loraVideosRef: React.MutableRefObject<Array<HTMLVideoElement | null>>;
  selectedTravelExample: number;
  loraPlaying: boolean;
  loadedImages: Set<string>;
  loadedVideos: Set<string>;
  autoAdvance: ReturnType<typeof useTravelAutoAdvance>;
  handleImageLoad: (src: string) => void;
  handleImageRef: (img: HTMLImageElement | null, src: string) => void;
  handleVideoLoad: (src: string) => void;
  handleSelectExample: (idx: number) => void;
  handleTravelVideoEnded: (idx: number) => void;
  handleVideoTimeUpdate: (idx: number, video: HTMLVideoElement) => void;
  playTravelVideo: (idx: number) => void;
  toggleLoraPlay: () => void;
  handleLoraVideoEnded: () => void;
}

export function usePhilosophyPaneMedia({
  isOpen,
  isClosing,
  isOpening,
  currentExample,
  travelExamples,
}: UsePhilosophyPaneMediaInput): UsePhilosophyPaneMediaResult {
  const philosophyVideoRef = useRef<HTMLVideoElement | null>(null);
  const travelVideoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null]);
  const loraVideosRef = useRef<(HTMLVideoElement | null)[]>([]);
  const loadedImagesRef = useRef<Set<string>>(new Set());

  const [selectedTravelExample, setSelectedTravelExample] = useState(0);
  const [loraPlaying, setLoraPlaying] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [loadedVideos, setLoadedVideos] = useState<Set<string>>(new Set());

  const autoAdvance = useTravelAutoAdvance({
    totalExamples: travelExamples.length,
    onExampleChange: setSelectedTravelExample,
  });

  const handleImageLoad = useCallback((src: string) => {
    if (loadedImagesRef.current.has(src)) {
      return;
    }
    loadedImagesRef.current.add(src);
    setLoadedImages((previous) => new Set(previous).add(src));
  }, []);

  const handleImageRef = useCallback((img: HTMLImageElement | null, src: string) => {
    if (img && img.complete && img.naturalWidth > 0 && !loadedImagesRef.current.has(src)) {
      handleImageLoad(src);
    }
  }, [handleImageLoad]);

  const handleVideoLoad = useCallback((src: string) => {
    setLoadedVideos((previous) => new Set(previous).add(src));
  }, []);

  const {
    setVideoProgress,
    handleVideoStarted,
    handleVideoEnded: onVideoEnded,
    handleVideoTimeUpdate: onVideoTimeUpdate,
    handleManualSelect,
    resetAll,
  } = autoAdvance;

  const playTravelVideo = useCallback((idx: number) => {
    const video = travelVideoRefs.current[idx];
    if (!video) {
      return;
    }

    video.currentTime = 0;
    setVideoProgress(0);

    const onPlaying = () => {
      handleVideoStarted(idx);
      video.removeEventListener('playing', onPlaying);
    };
    video.addEventListener('playing', onPlaying);

    void safePlay(video, 'PhilosophyPane.playTravelVideo', {
      exampleIndex: idx,
      videoSrc: video.currentSrc || video.src,
    }).then((playResult) => {
      if (!playResult.ok) {
        video.removeEventListener('playing', onPlaying);
      }
    });
  }, [handleVideoStarted, setVideoProgress]);

  const handleTravelVideoEnded = useCallback((idx: number) => {
    const nextIdx = (idx + 1) % travelExamples.length;
    const nextVideo = travelVideoRefs.current[nextIdx];
    if (nextVideo) {
      nextVideo.load();
    }
    onVideoEnded(idx);
  }, [onVideoEnded, travelExamples.length]);

  const handleVideoTimeUpdate = useCallback((idx: number, video: HTMLVideoElement) => {
    onVideoTimeUpdate(idx, video.currentTime, video.duration, selectedTravelExample);
  }, [onVideoTimeUpdate, selectedTravelExample]);

  const handleSelectExample = useCallback((idx: number) => {
    handleManualSelect(idx);
  }, [handleManualSelect]);

  const toggleLoraPlay = useCallback(() => {
    if (loraPlaying) {
      setLoraPlaying(false);
      loraVideosRef.current.forEach((video) => {
        video?.pause();
      });
      return;
    }

    const video = loraVideosRef.current[0];
    if (!video) {
      return;
    }

    video.currentTime = 0;
    const onPlaying = () => {
      setLoraPlaying(true);
      video.removeEventListener('playing', onPlaying);
    };
    video.addEventListener('playing', onPlaying);

    void safePlay(video, 'PhilosophyPane.toggleLoraPlay', {
      videoSrc: video.currentSrc || video.src,
    }).then((playResult) => {
      if (!playResult.ok) {
        video.removeEventListener('playing', onPlaying);
      }
    });
  }, [loraPlaying]);

  const handleLoraVideoEnded = useCallback(() => {
    const video = loraVideosRef.current[0];
    if (video) {
      video.currentTime = 0;
    }
    setLoraPlaying(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      return;
    }
    setLoraPlaying(false);
    loraVideosRef.current.forEach((video) => {
      if (!video) {
        return;
      }
      video.pause();
      video.currentTime = 0;
    });
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isOpening) {
      playTravelVideo(selectedTravelExample);
    }
  }, [isOpen, isOpening, playTravelVideo, selectedTravelExample]);

  useEffect(() => {
    if (isOpen || isClosing) {
      return;
    }
    travelVideoRefs.current.forEach((video) => {
      if (!video) {
        return;
      }
      video.pause();
      video.currentTime = 0;
    });
    resetAll();
  }, [isOpen, isClosing, resetAll]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const imagesToPreload = [
      currentExample.image1,
      currentExample.image2,
      '/916-output-poster.jpg',
      '/h-output-poster.jpg',
      '/916-1.jpg', '/916-2.jpg', '/916-3.jpg', '/916-4.jpg',
      '/h1-crop.webp', '/h2-crop.webp', '/h3-crop.webp', '/h4-crop.webp',
      '/h5-crop.webp', '/h6-crop.webp', '/h7-crop.webp',
      '/lora-3.webp', '/lora-4.webp', '/lora-grid-combined-poster.jpg',
    ];

    imagesToPreload.forEach((src) => {
      const img = new Image();
      img.onload = () => handleImageLoad(src);
      img.src = src;
      if (img.complete) {
        handleImageLoad(src);
      }
    });
  }, [isOpen, currentExample.image1, currentExample.image2, handleImageLoad]);

  return {
    philosophyVideoRef,
    travelVideoRefs,
    loraVideosRef,
    selectedTravelExample,
    loraPlaying,
    loadedImages,
    loadedVideos,
    autoAdvance,
    handleImageLoad,
    handleImageRef,
    handleVideoLoad,
    handleSelectExample,
    handleTravelVideoEnded,
    handleVideoTimeUpdate,
    playTravelVideo,
    toggleLoraPlay,
    handleLoraVideoEnded,
  };
}
