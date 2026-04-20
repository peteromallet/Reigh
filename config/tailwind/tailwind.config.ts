import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import containerQueries from "@tailwindcss/container-queries";
import { themeColors } from "./theme/themeColors";
import { themeKeyframes } from "./theme/themeKeyframes";
import { themeAnimations } from "./theme/themeAnimations";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
		"./packages/*/src/**/*.{ts,tsx}",
	],
	prefix: "",
	corePlugins: {
	},
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontSize: {
				'sm': ['0.875rem', '1.25rem'],
			},
			fontFamily: {
				'cocogoose': ['"Cocogoose"', '"CocogooseNumbers"', '"Inter"', 'system-ui', '-apple-system', '"BlinkMacSystemFont"', '"Segoe UI"', '"Roboto"', 'sans-serif'],
				'cocogoose-numbers': ['"Inter"', 'system-ui', '-apple-system', '"BlinkMacSystemFont"', '"Segoe UI"', '"Roboto"', 'sans-serif'],
				'crimson': ['Crimson Text', 'serif'],
				'inter': ['Inter', 'sans-serif'],
				'playfair': ['Playfair Display', 'serif'],
			},
			fontWeight: {
				'ultralight': '200',
			},
			colors: themeColors,
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				'xl': '1rem',
				'2xl': '1.5rem',
				'3xl': '2rem',
			},
			spacing: {
				'18': '4.5rem',
				'22': '5.5rem',
				'88': '22rem',
				'104': '26rem',
				'128': '32rem',
				'144': '36rem',
			},
			letterSpacing: {
				'widest': '0.2em',
				'ultra-wide': '0.3em',
			},
			blur: {
				'xs': '2px',
				'4xl': '72px',
				'5xl': '96px',
			},
			scale: {
				'102': '1.02',
				'103': '1.03',
				'98': '0.98',
				'97': '0.97',
			},
			rotate: {
				'0.5': '0.5deg',
				'1.5': '1.5deg',
				'2.5': '2.5deg',
			},
			skew: {
				'0.5': '0.5deg',
				'1.5': '1.5deg',
				'2.5': '2.5deg',
			},
			keyframes: themeKeyframes,
			transitionTimingFunction: {
				'smooth': 'cubic-bezier(0.22, 1, 0.36, 1)',
			},
			animation: themeAnimations,
			boxShadow: {
				'wes': '0 10px 40px -10px hsl(var(--primary) / 0.2), 0 4px 20px -4px hsl(var(--accent) / 0.1)',
				'wes-hover': '0 2px 8px hsl(var(--primary) / 0.12), 0 4px 24px hsl(var(--primary) / 0.08), 0 8px 48px hsl(var(--primary) / 0.04)',
				'wes-vintage': '0 8px 32px -8px hsl(var(--wes-vintage-gold) / 0.3), inset 0 1px 0 hsl(var(--wes-cream) / 0.5)',
				'wes-ornate': '0 0 0 1px hsl(var(--wes-vintage-gold) / 0.2), 0 2px 4px hsl(var(--primary) / 0.1), 0 8px 16px hsl(var(--primary) / 0.1)',
				'wes-deep': '0 25px 50px -12px hsl(var(--primary) / 0.4), 0 0 0 1px hsl(var(--wes-vintage-gold) / 0.2)',
				'inner-vintage': 'inset 0 2px 4px hsl(var(--primary) / 0.1), inset 0 0 0 1px hsl(var(--wes-vintage-gold) / 0.1)',
			},
			backdropBlur: {
				'xs': '2px',
			},
			borderWidth: {
				'3': '3px',
				'5': '5px',
				'6': '6px',
			},
			textShadow: {
				'vintage': '0 0 5px hsl(var(--wes-vintage-gold) / 0.5)',
				'vintage-glow': '0 0 10px hsl(var(--wes-vintage-gold) / 0.8), 0 0 20px hsl(var(--wes-vintage-gold) / 0.5)',
			},
			backgroundImage: {
				'vintage-gradient': 'linear-gradient(135deg, hsl(var(--wes-cream)) 0%, hsl(var(--wes-pink) / 0.3) 100%)',
				'film-grain': 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
				'wes-pattern': 'linear-gradient(45deg, hsl(var(--accent)) 25%, transparent 25%)',
			}
		}
	},
	plugins: [
		tailwindcssAnimate,
		containerQueries,
		function({ addUtilities }: { addUtilities: (utilities: Record<string, Record<string, string>>) => void }) {
			const newUtilities = {
				'.text-shadow-vintage': {
					textShadow: '0 0 5px hsl(var(--wes-vintage-gold) / 0.5)',
				},
				'.text-shadow-vintage-glow': {
					textShadow: '0 0 10px hsl(var(--wes-vintage-gold) / 0.8), 0 0 20px hsl(var(--wes-vintage-gold) / 0.5)',
				},
				'.text-shadow-none': {
					textShadow: 'none',
				},
			}
			addUtilities(newUtilities)
		}
	],
} satisfies Config;
