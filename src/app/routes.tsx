import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import ToolSelectorPage from '@/pages/ToolSelectorPage';
import HomePage from '@/pages/HomePage';
import ArtPage from '@/pages/ArtPage';
// Placeholder imports for tool pages - these will be updated in later phases
import ImageGenerationToolPage from '@/tools/image-generation/pages/ImageGenerationToolPage';
import VideoTravelToolPage from '@/tools/video-travel/pages/VideoTravelToolPage';
import NotFoundPage from '@/pages/NotFoundPage'; // Assuming NotFoundPage will be moved here or created
import { LastAffectedShotProvider } from '@/shared/contexts/LastAffectedShotContext';
import EditTravelToolPage from '@/tools/edit-travel/pages/EditTravelToolPage';
import ShotsPage from "@/pages/ShotsPage";
import GenerationsPage from "@/pages/GenerationsPage"; // Import the new GenerationsPage
import Layout from './Layout'; // Import the new Layout component
import { AppEnv } from '@/types/env';

// Determine the environment
const currentEnv = (import.meta.env.VITE_APP_ENV?.toLowerCase() || AppEnv.DEV);

const router = createBrowserRouter([
  // HomePage route without Layout (no header) when in web environment
  ...(currentEnv === AppEnv.WEB ? [{
    path: '/',
    element: <HomePage />,
    errorElement: <NotFoundPage />,
  }] : []),
  
  {
    element: <Layout />,
    errorElement: <NotFoundPage />,
    children: [
      // ToolSelectorPage at root for non-web environments
      ...(currentEnv !== AppEnv.WEB ? [{
        path: '/',
        element: <ToolSelectorPage />,
      }] : []),
      {
        path: '/tools/image-generation',
        element: <ImageGenerationToolPage />,
      },
      {
        path: '/tools/video-travel',
        element: <VideoTravelToolPage />,
      },
      {
        path: '/tools/edit-travel',
        element: <EditTravelToolPage />,
      },
      {
        path: '/shots',
        element: <ShotsPage />,
      },
              {
          path: '/generations',
          element: <GenerationsPage />,
        },
        {
          path: '/art',
          element: <ArtPage />,
        },
      // Any other top-level page routes can become children here
    ]
  },
  // If you have routes that shouldn't use the Layout, they can remain outside
  // For example, a dedicated login page or a full-screen error page.
  // However, for most standard pages, they will be children of the Layout route.
  // The root NotFoundPage is handled by errorElement on the Layout route.
  // If you need a catch-all * route, it can be added as a child of Layout as well.
  {
    path: '*',
    element: <NotFoundPage /> // This can be a child of Layout or a separate top-level route
                            // If child of Layout: { path: '*', element: <NotFoundPage /> }
                            // If you want NotFoundPage to also have the Layout, put it in children array.
                            // For a non-layout 404, keep it separate or rely on the errorElement.
  }
]);

export function AppRoutes() {
  return <RouterProvider router={router} />;
} 