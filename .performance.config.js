/**
 * Performance Optimization Configuration
 * Enhances build performance and runtime efficiency
 */

export default {
  // Build optimizations
  build: {
    // Enable code splitting for better caching
    codeSplitting: true,
    
    // Minimize bundle size
    minify: true,
    
    // Tree shaking configuration
    treeShaking: {
      enabled: true,
      moduleSideEffects: false,
    },
    
    // Chunk optimization
    chunkStrategy: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendor',
        priority: 10,
      },
      common: {
        minChunks: 2,
        priority: 5,
        reuseExistingChunk: true,
      },
    },
  },

  // Runtime optimizations
  runtime: {
    // Lazy loading configuration
    lazyLoad: {
      components: [
        'CodeMirrorEditor',
        'Terminal',
        'Preview',
      ],
      routes: [
        'chat',
        'settings',
      ],
    },
    
    // Caching strategy
    cache: {
      enabled: true,
      strategy: 'stale-while-revalidate',
      maxAge: 3600, // 1 hour
    },
    
    // Prefetch configuration
    prefetch: {
      enabled: true,
      priority: ['critical', 'high'],
    },
  },

  // Asset optimization
  assets: {
    // Image optimization
    images: {
      formats: ['webp', 'avif'],
      quality: 85,
      lazyLoad: true,
    },
    
    // Font optimization
    fonts: {
      preload: ['Inter', 'JetBrains Mono'],
      display: 'swap',
    },
  },

  // Monitoring
  monitoring: {
    // Performance metrics to track
    metrics: [
      'FCP', // First Contentful Paint
      'LCP', // Largest Contentful Paint
      'FID', // First Input Delay
      'CLS', // Cumulative Layout Shift
      'TTFB', // Time to First Byte
    ],
    
    // Performance budgets
    budgets: {
      javascript: 300, // KB
      css: 50, // KB
      images: 500, // KB
    },
  },
};
