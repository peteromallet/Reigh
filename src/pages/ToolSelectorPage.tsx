import { Link } from 'react-router-dom';
import { AppEnv, LOCAL_ENVS, type AppEnvValue } from '../types/env';
import { Paintbrush, Video, Edit, Sparkles, Camera, Palette, Zap, Star, Crown, Gem } from 'lucide-react';

interface Tool {
  name: string;
  path: string;
  description: string;
  environments: AppEnvValue[];
  icon: React.ComponentType<any>;
  gradient: string;
  accent: string;
  ornament: string;
  badge?: string;
}

const tools: Tool[] = [
  {
    name: 'Generate Images with Structure',
    path: '/tools/image-generation',
    description: 'Craft and generate intricate images using a structured approach with precision and artistic flair, bringing your creative visions to life.',
    environments: LOCAL_ENVS,
    icon: Paintbrush,
    gradient: 'from-wes-pink via-wes-lavender to-wes-dusty-blue',
    accent: 'wes-pink',
    ornament: '❋',
    badge: 'Featured',
  },
  {
    name: 'Travel Between Images',
    path: '/tools/video-travel',
    description: 'Create mesmerizing video sequences by defining elegant paths between existing images, weaving stories through visual transitions.',
    environments: LOCAL_ENVS,
    icon: Video,
    gradient: 'from-wes-mint via-wes-sage to-wes-dusty-blue',
    accent: 'wes-mint',
    ornament: '◆',
    badge: 'Popular',
  },
  {
    name: 'Edit Travel (Image Edit)',
    path: '/tools/edit-travel',
    description: 'Transform existing images using poetic text prompts with the sophisticated Fal Kontext model, reimagining reality with artistic precision.',
    environments: [AppEnv.DEV],
    icon: Edit,
    gradient: 'from-wes-yellow via-wes-salmon to-wes-pink',
    accent: 'wes-yellow',
    ornament: '✧',
    badge: 'New',
  },
  {
    name: 'Generate Images In-Scene',
    path: '#',
    description: 'Generate images that are contextually placed within a scene.',
    environments: LOCAL_ENVS,
    icon: Palette,
    gradient: 'from-wes-coral via-wes-peach to-wes-cream',
    accent: 'wes-coral',
    ornament: '✦',
    badge: 'New',
  },
  // Placeholder examples if you add more tools:
  // { name: 'Placeholder Tool 1', path: '#', description: 'Future tool placeholder.', environments: [AppEnv.DEV, AppEnv.WEB] }, // DEV and WEB
  // { name: 'Placeholder Tool 2', path: '#', description: 'Another future tool placeholder.', environments: [AppEnv.LOCAL, AppEnv.WEB] }, // LOCAL and WEB
];

export default function ToolSelectorPage() {
  const currentEnv = (import.meta.env.VITE_APP_ENV?.toLowerCase() || AppEnv.DEV) as AppEnvValue;

  const visibleTools = tools.filter(tool => {
    if (currentEnv === AppEnv.DEV) {
      return true; // Show all tools if current environment is DEV
    }
    // For other environments (local, web), respect the tool's specific environments array
    return tool.environments.includes(currentEnv);
  });

  return (
    <div className="min-h-screen wes-texture relative overflow-hidden">
      {/* Enhanced background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-wes-cream via-white to-wes-mint/20 opacity-60"></div>
      <div className="absolute inset-0 wes-chevron-pattern opacity-30"></div>
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-wes-vintage-gold via-wes-coral to-wes-mint"></div>
      
      {/* Floating ornamental elements */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-wes-pink/10 rounded-full blur-3xl animate-parallax-float"></div>
      <div className="absolute top-40 right-20 w-24 h-24 bg-wes-yellow/15 rounded-full blur-2xl animate-parallax-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute bottom-20 left-1/4 w-40 h-40 bg-wes-lavender/10 rounded-full blur-3xl animate-parallax-float" style={{ animationDelay: '4s' }}></div>
      <div className="absolute top-1/3 right-1/3 w-20 h-20 bg-wes-coral/10 rounded-full blur-xl animate-bounce-gentle" style={{ animationDelay: '1s' }}></div>
      <div className="absolute bottom-1/3 left-1/3 w-28 h-28 bg-wes-sage/10 rounded-full blur-2xl animate-sway" style={{ animationDelay: '3s' }}></div>
      
      {/* Vintage film strips */}
      <div className="absolute left-0 top-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
      <div className="absolute right-0 bottom-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
      
      <div className="container mx-auto px-4 py-16 relative z-10">
        {/* Enhanced Tools Grid */}
        {visibleTools.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-16 max-w-7xl mx-auto">
            {visibleTools.map((tool, index) => {
              const IconComponent = tool.icon;
              return (
                <Link
                  to={tool.path}
                  key={tool.name}
                  className="group block animate-fade-in-up wes-corners"
                >
                  <div className="wes-tool-card relative overflow-hidden h-full wes-polaroid">
                    {/* Badge */}
                    {tool.badge && (
                      <div className="absolute -top-3 -right-3 z-10">
                        <div className="bg-gradient-to-r from-wes-vintage-gold to-wes-mustard text-primary text-xs font-bold px-3 py-1 rounded-full border-2 border-primary/20 shadow-wes-ornate transform rotate-12 animate-bounce-gentle">
                          {tool.badge}
                        </div>
                      </div>
                    )}

                    {/* Tool Icon & Header */}
                    <div className="wes-symmetry mb-8 relative">
                      <div className="wes-ornament mb-4">
                        <div className={`w-24 h-24 bg-gradient-to-br ${tool.gradient} rounded-3xl flex items-center justify-center shadow-wes-deep group-hover:shadow-wes-hover transition-all duration-700 group-hover:scale-110 group-hover:rotate-6 wes-stamp`}>
                          <IconComponent className="w-12 h-12 text-white drop-shadow-lg" />
                        </div>
                      </div>
                      
                      <div className="mt-6">
                        <h2 className="font-playfair text-3xl font-bold text-primary mb-3 group-hover:text-primary/80 transition-colors duration-300 text-shadow-vintage">
                          {tool.name}
                        </h2>
                        <div className={`w-20 h-1.5 bg-gradient-to-r from-${tool.accent} to-wes-vintage-gold rounded-full mx-auto group-hover:w-32 transition-all duration-700 shadow-inner-vintage`}></div>
                      </div>
                    </div>

                    {/* Enhanced Description */}
                    <div className="px-4 mb-6">
                      <p className="font-inter text-muted-foreground leading-relaxed text-center tracking-wide">
                        {tool.description}
                      </p>
                    </div>

                    {/* Enhanced Decorative Elements */}
                    <div className="absolute top-6 right-6 opacity-20 group-hover:opacity-50 transition-opacity duration-500">
                      <div className="text-2xl text-wes-vintage-gold animate-rotate-slow">
                        {tool.ornament}
                      </div>
                    </div>
                    
                    <div className="absolute top-6 left-6 opacity-15 group-hover:opacity-40 transition-opacity duration-500">
                      <Crown className="w-6 h-6 text-primary animate-sway" />
                    </div>
                    
                    <div className="absolute bottom-6 left-6 opacity-10 group-hover:opacity-30 transition-opacity duration-500">
                      <div className="w-10 h-10 border-3 border-wes-vintage-gold rounded-full flex items-center justify-center">
                        <div className="w-3 h-3 bg-wes-coral rounded-full animate-vintage-pulse"></div>
                      </div>
                    </div>

                    <div className="absolute bottom-6 right-6 opacity-15 group-hover:opacity-40 transition-opacity duration-500">
                      <Zap className="w-5 h-5 text-wes-mustard animate-bounce-gentle" />
                    </div>

                    {/* Enhanced hover shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-wes-vintage-gold/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1200 ease-out"></div>
                    
                    {/* Additional shimmer layer */}
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="wes-symmetry py-24 animate-scale-in">
            <div className="wes-vintage-card wes-ornate-frame max-w-3xl mx-auto p-16 wes-filmstrip">
              <div className="mb-12 wes-viewfinder">
                <Camera className="w-20 h-20 text-muted-foreground mx-auto opacity-50" />
              </div>
              
              <h2 className="font-playfair text-4xl font-bold text-primary mb-6 text-shadow-vintage">
                No Tools Available
              </h2>
              
              <div className="wes-divider w-full max-w-sm mx-auto mb-8"></div>
              
              <p className="font-inter text-xl text-muted-foreground mb-8 leading-relaxed">
                {currentEnv === AppEnv.DEV && tools.length > 0 ? 
                  'No tools are configured to be visible in the DEV environment. Check tool definitions in ToolSelectorPage.tsx' :
                  `No tools available for the current environment (${currentEnv}).`
                }
              </p>
              
              {/* Enhanced error messages */}
              {currentEnv !== AppEnv.DEV && !tools.some(t => t.environments.includes(currentEnv)) && (
                <div className="wes-vintage-card bg-wes-yellow/20 border-3 border-wes-vintage-gold/40 p-6 rounded-2xl mb-8 wes-stamp">
                  <p className="font-inter text-sm text-muted-foreground">
                    You might want to check the `environments` array for each tool in `ToolSelectorPage.tsx` or set VITE_APP_ENV to `dev` to see all development tools.
                  </p>
                </div>
              )}
               
              {currentEnv === AppEnv.DEV && !tools.some(t => t.environments.includes(AppEnv.DEV)) && tools.length > 0 && (
                <div className="wes-vintage-card bg-wes-pink/20 border-3 border-wes-coral/40 p-6 rounded-2xl wes-stamp">
                  <p className="font-inter text-sm text-muted-foreground">
                    Ensure tools intended for development have `AppEnv.DEV` in their `environments` array in `ToolSelectorPage.tsx`.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Enhanced footer decorative line */}
        <div className="mt-32 flex items-center justify-center">
          <div className="flex items-center space-x-6">
            <div className="w-32 h-px bg-gradient-to-r from-transparent to-wes-vintage-gold/60"></div>
            <Star className="w-3 h-3 text-wes-vintage-gold animate-rotate-slow" />
            <div className="w-4 h-4 bg-wes-dusty-blue rounded-full animate-vintage-pulse wes-badge"></div>
            <Gem className="w-4 h-4 text-wes-coral animate-bounce-gentle" />
            <div className="w-20 h-px bg-wes-vintage-gold/60"></div>
            <div className="text-wes-vintage-gold text-xl animate-sway">❋</div>
            <div className="w-20 h-px bg-wes-vintage-gold/60"></div>
            <Gem className="w-4 h-4 text-wes-mint animate-bounce-gentle" style={{ animationDelay: '1s' }} />
            <div className="w-4 h-4 bg-wes-pink rounded-full animate-vintage-pulse wes-badge" style={{ animationDelay: '2s' }}></div>
            <Star className="w-3 h-3 text-wes-vintage-gold animate-rotate-slow" style={{ animationDelay: '1s' }} />
            <div className="w-32 h-px bg-gradient-to-l from-transparent to-wes-vintage-gold/60"></div>
          </div>
        </div>
      </div>
    </div>
  );
} 