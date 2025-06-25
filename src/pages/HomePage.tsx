import React, { useState } from 'react';
import { ArrowRight, Sparkles, Image as ImageIcon, Video, UserPlus, Users, ChevronDown, ChevronUp } from 'lucide-react';

export default function HomePage() {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  const ImageTravelAnimation = () => {
    return (
      <div 
        className="flex items-center justify-center mb-12 cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative flex items-center space-x-2">
          {/* Single morphing rectangle */}
          <div 
            className={`w-20 h-12 rounded-lg border-2 shadow-lg transition-all duration-500 ease-in-out ${
              isHovered 
                ? 'bg-gradient-to-r from-wes-vintage-gold via-wes-coral to-wes-sage border-white/50 scale-110' 
                : 'bg-wes-vintage-gold border-wes-vintage-gold/30 scale-100'
            }`}
          >
            <div className="absolute inset-2 bg-white/20 rounded-md"></div>
          </div>
        </div>

        {/* Hint text */}
        <div className="absolute -bottom-6 text-xs text-muted-foreground/60 font-inter">
          hover to see the blend
        </div>
      </div>
    );
  };

  const examples = [
    {
      id: 1,
      inputTitle: "Serene Lake at Dawn",
      inputDesc: "A misty morning scene with still waters",
      outputTitle: "Turbulent Storm",
      outputDesc: "The same lake transformed into dramatic waves",
      transition: "calm → storm"
    },
    {
      id: 2,
      inputTitle: "Vintage Portrait",
      inputDesc: "A classic black and white photograph",
      outputTitle: "Modern Digital Art",
      outputDesc: "Reimagined with contemporary artistic style",
      transition: "classic → modern"
    },
    {
      id: 3,
      inputTitle: "Urban Street Scene",
      inputDesc: "Busy city intersection in daylight",
      outputTitle: "Neon-lit Night",
      outputDesc: "The same street bathed in electric colors",
      transition: "day → night"
    }
  ];

  return (
    <div className="min-h-screen wes-texture relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-wes-cream via-white to-wes-mint/20 opacity-60"></div>
      <div className="absolute inset-0 wes-chevron-pattern opacity-30"></div>
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-wes-vintage-gold via-wes-coral to-wes-mint"></div>
      
      {/* Floating ornamental elements */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-wes-pink/10 rounded-full blur-3xl animate-parallax-float"></div>
      <div className="absolute top-40 right-20 w-24 h-24 bg-wes-yellow/15 rounded-full blur-2xl animate-parallax-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute bottom-20 left-1/4 w-40 h-40 bg-wes-lavender/10 rounded-full blur-3xl animate-parallax-float" style={{ animationDelay: '4s' }}></div>
      
      {/* Top Navigation Links */}
      <div className="absolute top-8 right-8 z-20 flex items-center space-x-6">
        <a
          href="#signup"
          className="group flex items-center space-x-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border-2 border-wes-vintage-gold/20 hover:border-wes-vintage-gold/40 transition-all duration-300 hover:shadow-wes-ornate"
        >
          <UserPlus className="w-4 h-4 text-wes-vintage-gold group-hover:text-wes-mustard transition-colors" />
          <span className="font-inter text-sm font-medium text-primary group-hover:text-primary/80">Sign Up</span>
        </a>
        
        <a
          href="#creative-partner"
          className="group flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-wes-coral/90 to-wes-pink/90 backdrop-blur-sm rounded-full border-2 border-wes-coral/30 hover:border-wes-coral/50 transition-all duration-300 hover:shadow-wes-ornate text-white hover:from-wes-coral hover:to-wes-pink"
        >
          <Users className="w-4 h-4 group-hover:scale-110 transition-transform" />
          <span className="font-inter text-sm font-medium">Creative Partner Programme</span>
        </a>
      </div>

      <div className="container mx-auto px-4 py-24 relative z-10">
        {/* Hero Section */}
        <div className="text-center mb-32 mt-16">
          <div className="max-w-4xl mx-auto animate-fade-in-up">
            {/* Image Travel Animation */}
            <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
              <ImageTravelAnimation />
            </div>

            {/* Main title */}
            <h1 className="font-playfair text-6xl md:text-8xl font-bold text-primary mb-8 text-shadow-vintage animate-scale-in">
              Reigh
            </h1>
            
            {/* Decorative divider */}
            <div className="w-32 h-1.5 bg-gradient-to-r from-wes-pink to-wes-vintage-gold rounded-full mx-auto mb-8 shadow-inner-vintage"></div>
            
            {/* Subtitle */}
            <p className="font-inter text-xl md:text-2xl text-muted-foreground leading-relaxed tracking-wide mb-12 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
              A tool for for the found art of travelling between images
            </p>
            
            {/* Ornamental elements */}
            <div className="flex justify-center items-center space-x-8 opacity-50">
              <div className="text-3xl text-wes-vintage-gold animate-rotate-slow">❋</div>
              <div className="text-2xl text-wes-coral animate-bounce-gentle">◆</div>
              <div className="text-3xl text-wes-mint animate-sway">✧</div>
            </div>
          </div>
        </div>

        {/* Examples Section */}
        <div className="max-w-6xl mx-auto mb-24 animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
          <div className="text-center mb-16">
            <h2 className="font-playfair text-4xl md:text-5xl font-bold text-primary mb-6 text-shadow-vintage">
              Visual Journeys
            </h2>
            <div className="w-24 h-1 bg-gradient-to-r from-wes-sage to-wes-dusty-blue rounded-full mx-auto mb-6"></div>
            <p className="font-inter text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Witness the metamorphosis of images through time and imagination
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {examples.map((example, index) => (
              <div key={example.id} className="wes-vintage-card group animate-fade-in-up" style={{ animationDelay: `${0.8 + index * 0.2}s` }}>
                <div className="p-8">
                  {/* Input */}
                  <div className="mb-6">
                    <div className="flex items-center mb-3">
                      <ImageIcon className="w-5 h-5 text-wes-sage mr-2" />
                      <h3 className="font-playfair text-lg font-semibold text-primary">
                        {example.inputTitle}
                      </h3>
                    </div>
                    <div className="w-full h-32 bg-gradient-to-br from-wes-cream to-wes-mint/20 rounded-lg border-2 border-wes-vintage-gold/20 flex items-center justify-center mb-3">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-wes-vintage-gold/20 rounded-full flex items-center justify-center mx-auto mb-2">
                          <ImageIcon className="w-6 h-6 text-wes-vintage-gold" />
                        </div>
                        <p className="text-xs text-muted-foreground font-inter">Input Image</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground font-inter">{example.inputDesc}</p>
                  </div>

                  {/* Transition Arrow */}
                  <div className="flex items-center justify-center mb-6">
                    <div className="flex items-center space-x-2 text-wes-coral">
                      <ArrowRight className="w-5 h-5" />
                      <span className="text-sm font-inter font-medium">{example.transition}</span>
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>

                  {/* Output */}
                  <div>
                    <div className="flex items-center mb-3">
                      <Video className="w-5 h-5 text-wes-coral mr-2" />
                      <h3 className="font-playfair text-lg font-semibold text-primary">
                        {example.outputTitle}
                      </h3>
                    </div>
                    <div className="w-full h-32 bg-gradient-to-br from-wes-pink/20 to-wes-coral/20 rounded-lg border-2 border-wes-coral/20 flex items-center justify-center mb-3">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-wes-coral/20 rounded-full flex items-center justify-center mx-auto mb-2">
                          <Video className="w-6 h-6 text-wes-coral" />
                        </div>
                        <p className="text-xs text-muted-foreground font-inter">Video Journey</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground font-inter">{example.outputDesc}</p>
                  </div>

                  {/* Decorative ornament */}
                  <div className="absolute top-4 right-4 opacity-20 group-hover:opacity-50 transition-opacity duration-500">
                    <Sparkles className="w-5 h-5 text-wes-vintage-gold" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Art Gallery Section */}
        <div className="max-w-6xl mx-auto mb-24 animate-fade-in-up" style={{ animationDelay: '1.2s' }}>
          <div className="text-center mb-16">
            <h2 className="font-playfair text-4xl md:text-5xl font-bold text-primary mb-6 text-shadow-vintage">
              Community Art
            </h2>
            <div className="w-24 h-1 bg-gradient-to-r from-wes-coral to-wes-vintage-gold rounded-full mx-auto mb-6"></div>
            <p className="font-inter text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Discover the beautiful journeys our community has created
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {/* Art Placeholder 1 */}
            <div className="wes-vintage-card group">
              <div className="aspect-video bg-gradient-to-br from-wes-vintage-gold/20 to-wes-mustard/20 rounded-lg border-2 border-wes-vintage-gold/20 flex items-center justify-center mb-4 overflow-hidden">
                <div className="text-center">
                  <div className="w-16 h-16 bg-wes-vintage-gold/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Video className="w-8 h-8 text-wes-vintage-gold" />
                  </div>
                  <p className="text-sm text-muted-foreground font-inter">Journey #1</p>
                </div>
              </div>
              <div className="p-6">
                <h3 className="font-playfair text-lg font-semibold text-primary mb-2">Morning to Midnight</h3>
                <p className="text-sm text-muted-foreground font-inter">A serene transition from dawn's first light to the electric energy of city nightlife.</p>
              </div>
            </div>

            {/* Art Placeholder 2 */}
            <div className="wes-vintage-card group">
              <div className="aspect-video bg-gradient-to-br from-wes-coral/20 to-wes-pink/20 rounded-lg border-2 border-wes-coral/20 flex items-center justify-center mb-4 overflow-hidden">
                <div className="text-center">
                  <div className="w-16 h-16 bg-wes-coral/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Video className="w-8 h-8 text-wes-coral" />
                  </div>
                  <p className="text-sm text-muted-foreground font-inter">Journey #2</p>
                </div>
              </div>
              <div className="p-6">
                <h3 className="font-playfair text-lg font-semibold text-primary mb-2">Seasonal Metamorphosis</h3>
                <p className="text-sm text-muted-foreground font-inter">Watch as autumn leaves transform through winter snow into spring blossoms.</p>
              </div>
            </div>

            {/* Art Placeholder 3 */}
            <div className="wes-vintage-card group">
              <div className="aspect-video bg-gradient-to-br from-wes-sage/20 to-wes-mint/20 rounded-lg border-2 border-wes-sage/20 flex items-center justify-center mb-4 overflow-hidden">
                <div className="text-center">
                  <div className="w-16 h-16 bg-wes-sage/30 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Video className="w-8 h-8 text-wes-sage" />
                  </div>
                  <p className="text-sm text-muted-foreground font-inter">Journey #3</p>
                </div>
              </div>
              <div className="p-6">
                <h3 className="font-playfair text-lg font-semibold text-primary mb-2">Ocean Dreams</h3>
                <p className="text-sm text-muted-foreground font-inter">A meditative flow between calm waters and turbulent waves of emotion.</p>
              </div>
            </div>
          </div>

          {/* View All Art Link */}
          <div className="text-center">
            <a
              href="/art"
              className="inline-flex items-center space-x-3 px-8 py-4 bg-gradient-to-r from-wes-sage to-wes-mint text-white rounded-full border-2 border-wes-sage/30 hover:border-wes-sage/50 transition-all duration-300 hover:shadow-wes-ornate hover:scale-105 font-inter font-medium"
            >
              <span>View All Community Art</span>
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        </div>

        {/* Philosophy and FAQ Side by Side */}
        <div className="max-w-7xl mx-auto mb-24 animate-fade-in-up" style={{ animationDelay: '1.4s' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            
            {/* Philosophy Section */}
            <div className="text-center">
              <div className="wes-ornate-frame p-8 h-full">
                <h2 className="font-playfair text-3xl md:text-4xl font-bold text-primary mb-6 text-shadow-vintage">
                  Philosophy
                </h2>
                <div className="w-20 h-1 bg-gradient-to-r from-wes-lavender to-wes-pink rounded-full mx-auto mb-8"></div>
                
                <div className="space-y-6 text-left">
                  <p className="font-inter text-base text-muted-foreground leading-relaxed">
                    In the spaces between images lies a universe of possibility. Reigh embraces the concept of 
                    <em className="text-primary font-medium"> found art</em> — discovering beauty not in the destination, 
                    but in the journey itself.
                  </p>
                  
                  <p className="font-inter text-base text-muted-foreground leading-relaxed">
                    Each transformation becomes a meditation on change, time, and the fluid nature of visual perception. 
                    We don't simply create; we uncover the hidden narratives that exist in the liminal spaces between 
                    one moment and the next.
                  </p>
                  
                  <p className="font-inter text-base text-muted-foreground leading-relaxed">
                    Like watching clouds shift across an endless sky, or observing how light travels across a room 
                    throughout the day, Reigh reveals the profound poetry embedded in transition — making visible 
                    the invisible threads that connect all things.
                  </p>
                </div>

                {/* Closing ornamental elements */}
                <div className="flex justify-center items-center space-x-6 mt-8 opacity-40">
                  <div className="text-xl text-wes-lavender animate-sway">✧</div>
                  <div className="text-2xl text-wes-vintage-gold animate-rotate-slow">❋</div>
                  <div className="text-xl text-wes-coral animate-bounce-gentle">◆</div>
                </div>
              </div>
            </div>

            {/* FAQ Section */}
            <div>
              <div className="text-center mb-8">
                <h2 className="font-playfair text-3xl md:text-4xl font-bold text-primary mb-6 text-shadow-vintage">
                  Frequently Asked Questions
                </h2>
                <div className="w-20 h-1 bg-gradient-to-r from-wes-coral to-wes-sage rounded-full mx-auto"></div>
              </div>

              <div className="space-y-4">
                {/* FAQ Item */}
                <div className="wes-vintage-card">
                  <button
                    className="w-full p-6 text-left flex items-center justify-between hover:bg-wes-cream/10 transition-colors"
                    onClick={() => setExpandedFAQ(expandedFAQ === 1 ? null : 1)}
                  >
                    <h3 className="font-playfair text-lg font-semibold text-primary flex items-start flex-1">
                      <span className="text-wes-coral mr-3 text-xl leading-none">Q:</span>
                      "I made something and it doesn't look what I want"
                    </h3>
                    {expandedFAQ === 1 ? (
                      <ChevronUp className="w-5 h-5 text-wes-coral flex-shrink-0 ml-4" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-wes-coral flex-shrink-0 ml-4" />
                    )}
                  </button>
                  
                  {expandedFAQ === 1 && (
                    <div className="px-6 pb-6 ml-8 space-y-4 animate-fade-in-up">
                      <p className="font-inter text-sm text-muted-foreground leading-relaxed">
                        This is the beauty of found art — sometimes the most profound discoveries happen when we let go of our expectations. Reigh is designed to reveal unexpected journeys between images, not to fulfill predetermined visions.
                      </p>
                      <p className="font-inter text-sm text-muted-foreground leading-relaxed">
                        Consider what emerged instead of what you intended. Often, the algorithm uncovers connections and transitions that our conscious minds wouldn't have imagined. The "mistake" might be pointing toward something more interesting than your original concept.
                      </p>
                      <p className="font-inter text-sm text-muted-foreground leading-relaxed">
                        Try adjusting your input images or experimenting with different sequences. Sometimes a small change in the starting point can lead to dramatically different — and surprisingly compelling — results.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Vintage film strips */}
      <div className="absolute left-0 top-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
      <div className="absolute right-0 bottom-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
    </div>
  );
} 