import React from 'react';
import { Video, Heart, Eye, Calendar } from 'lucide-react';

export default function ArtPage() {
  const artPieces = [
    {
      id: 1,
      title: "Morning to Midnight",
      artist: "Alex Chen",
      description: "A serene transition from dawn's first light to the electric energy of city nightlife.",
      date: "2024-01-15",
      views: 1240,
      likes: 89,
      color: "wes-vintage-gold"
    },
    {
      id: 2,
      title: "Seasonal Metamorphosis",
      artist: "Sarah Johnson",
      description: "Watch as autumn leaves transform through winter snow into spring blossoms.",
      date: "2024-01-12",
      views: 892,
      likes: 156,
      color: "wes-coral"
    },
    {
      id: 3,
      title: "Ocean Dreams",
      artist: "Marcus Rivera",
      description: "A meditative flow between calm waters and turbulent waves of emotion.",
      date: "2024-01-10",
      views: 2103,
      likes: 234,
      color: "wes-sage"
    },
    {
      id: 4,
      title: "Urban Solitude",
      artist: "Emma Thompson",
      description: "The quiet moments found in bustling city streets, from rush hour to stillness.",
      date: "2024-01-08",
      views: 756,
      likes: 67,
      color: "wes-lavender"
    },
    {
      id: 5,
      title: "Memory Palace",
      artist: "David Kim",
      description: "Childhood memories flowing into adult perspectives through time and space.",
      date: "2024-01-05",
      views: 1543,
      likes: 198,
      color: "wes-pink"
    },
    {
      id: 6,
      title: "Digital Analog",
      artist: "Zoe Martinez",
      description: "The bridge between vintage film photography and modern digital artistry.",
      date: "2024-01-03",
      views: 987,
      likes: 123,
      color: "wes-mustard"
    }
  ];

  return (
    <div className="min-h-screen wes-texture relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-wes-cream via-white to-wes-mint/20 opacity-60"></div>
      <div className="absolute inset-0 wes-chevron-pattern opacity-30"></div>
      
      {/* Floating ornamental elements */}
      <div className="absolute top-20 left-10 w-32 h-32 bg-wes-pink/10 rounded-full blur-3xl animate-parallax-float"></div>
      <div className="absolute top-40 right-20 w-24 h-24 bg-wes-yellow/15 rounded-full blur-2xl animate-parallax-float" style={{ animationDelay: '2s' }}></div>
      <div className="absolute bottom-20 left-1/4 w-40 h-40 bg-wes-lavender/10 rounded-full blur-3xl animate-parallax-float" style={{ animationDelay: '4s' }}></div>
      
      <div className="container mx-auto px-4 py-16 relative z-10">
        {/* Header */}
        <div className="text-center mb-16 animate-fade-in-up">
          <h1 className="font-playfair text-5xl md:text-7xl font-bold text-primary mb-8 text-shadow-vintage">
            Community Art Gallery
          </h1>
          <div className="w-32 h-1.5 bg-gradient-to-r from-wes-coral to-wes-vintage-gold rounded-full mx-auto mb-8 shadow-inner-vintage"></div>
          <p className="font-inter text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            A curated collection of visual journeys created by our community of artists and dreamers
          </p>
        </div>

        {/* Art Grid */}
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {artPieces.map((piece, index) => (
              <div 
                key={piece.id} 
                className="wes-vintage-card group animate-fade-in-up"
                style={{ animationDelay: `${0.2 + index * 0.1}s` }}
              >
                {/* Video Placeholder */}
                <div className={`aspect-video bg-gradient-to-br from-${piece.color}/20 to-${piece.color}/30 rounded-lg border-2 border-${piece.color}/20 flex items-center justify-center mb-4 overflow-hidden group-hover:border-${piece.color}/40 transition-all duration-300`}>
                  <div className="text-center">
                    <div className={`w-16 h-16 bg-${piece.color}/30 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-300`}>
                      <Video className={`w-8 h-8 text-${piece.color}`} />
                    </div>
                    <p className="text-sm text-muted-foreground font-inter">Click to play</p>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6">
                  <h3 className="font-playfair text-xl font-semibold text-primary mb-2 group-hover:text-primary/80 transition-colors">
                    {piece.title}
                  </h3>
                  <p className="text-sm text-muted-foreground font-inter mb-3">
                    by <span className="font-medium text-primary">{piece.artist}</span>
                  </p>
                  <p className="text-sm text-muted-foreground font-inter leading-relaxed mb-4">
                    {piece.description}
                  </p>
                  
                  {/* Stats */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-1">
                        <Eye className="w-3 h-3" />
                        <span>{piece.views.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Heart className="w-3 h-3" />
                        <span>{piece.likes}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(piece.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center mt-16 animate-fade-in-up" style={{ animationDelay: '0.8s' }}>
          <div className="wes-ornate-frame p-8 max-w-2xl mx-auto">
            <h2 className="font-playfair text-2xl font-semibold text-primary mb-4">
              Share Your Journey
            </h2>
            <p className="font-inter text-muted-foreground mb-6 leading-relaxed">
              Create your own visual journey and join our community of artists exploring the spaces between images.
            </p>
            <a
              href="#signup"
              className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-wes-coral to-wes-pink text-white rounded-full border-2 border-wes-coral/30 hover:border-wes-coral/50 transition-all duration-300 hover:shadow-wes-ornate font-inter font-medium"
            >
              <span>Start Creating</span>
            </a>
          </div>
        </div>
      </div>
      
      {/* Vintage film strips */}
      <div className="absolute left-0 top-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
      <div className="absolute right-0 bottom-1/4 w-8 h-64 wes-filmstrip opacity-20"></div>
    </div>
  );
} 