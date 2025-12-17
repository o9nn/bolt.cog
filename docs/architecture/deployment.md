# Deployment Architecture

This document outlines the deployment strategy, infrastructure, and operational aspects of the OpenBolt platform.

## Deployment Overview

OpenBolt is designed as a serverless-first application leveraging CloudFlare's edge computing platform for global performance and scalability.

```mermaid
graph TB
    subgraph "Developer Workflow"
        LocalDev[Local Development]
        GitRepo[Git Repository]
        CI[CI/CD Pipeline]
    end
    
    subgraph "CloudFlare Infrastructure"
        Workers[CloudFlare Workers]
        Pages[CloudFlare Pages]
        KV[CloudFlare KV Storage]
        R2[CloudFlare R2 Storage]
        DNS[CloudFlare DNS]
        CDN[Global CDN]
    end
    
    subgraph "External Services"
        Anthropic[Anthropic API]
        GitHub[GitHub OAuth]
        Analytics[Analytics Service]
    end
    
    subgraph "Global Edge Network"
        NA[North America]
        EU[Europe]
        ASIA[Asia Pacific]
        Other[Other Regions]
    end
    
    LocalDev --> GitRepo
    GitRepo --> CI
    CI --> Workers
    CI --> Pages
    
    Workers --> KV
    Workers --> R2
    Workers --> Anthropic
    Workers --> GitHub
    
    Pages --> CDN
    Workers --> CDN
    
    CDN --> NA
    CDN --> EU
    CDN --> ASIA
    CDN --> Other
    
    DNS --> CDN
    Workers --> Analytics
    
    style Workers fill:#f38020
    style Pages fill:#f38020
    style CDN fill:#f38020
    style KV fill:#f38020
```

## Infrastructure Components

### 1. CloudFlare Workers (Server-Side Logic)

```mermaid
graph LR
    subgraph "Worker Functions"
        ChatAPI[Chat API Worker]
        EnhancerAPI[Enhancer API Worker]
        AuthWorker[Auth Worker]
        ProxyWorker[Proxy Worker]
    end
    
    subgraph "Worker Runtime"
        V8Runtime[V8 JavaScript Runtime]
        EdgeLocation[Edge Location]
        KVBinding[KV Storage Binding]
        R2Binding[R2 Storage Binding]
    end
    
    ChatAPI --> V8Runtime
    EnhancerAPI --> V8Runtime
    AuthWorker --> V8Runtime
    ProxyWorker --> V8Runtime
    
    V8Runtime --> EdgeLocation
    V8Runtime --> KVBinding
    V8Runtime --> R2Binding
    
    style ChatAPI fill:#f38020
    style V8Runtime fill:#fff3e0
    style EdgeLocation fill:#e8f5e8
```

**Worker Responsibilities:**
- **Chat API Worker**: Handles AI chat interactions and streaming responses
- **Enhancer API Worker**: Processes prompt enhancement requests
- **Auth Worker**: Manages user authentication and session handling
- **Proxy Worker**: Handles external API proxying and rate limiting

### 2. CloudFlare Pages (Static Assets)

```mermaid
graph TB
    subgraph "Build Process"
        Source[Source Code]
        ViteBuild[Vite Build]
        Assets[Static Assets]
        RemixBuild[Remix Build]
    end
    
    subgraph "Pages Deployment"
        StaticFiles[Static Files]
        ServerFunctions[Server Functions]
        Preview[Preview Deployment]
        Production[Production Deployment]
    end
    
    subgraph "Global Distribution"
        EdgeCache[Edge Cache]
        CDNNodes[CDN Nodes]
        BrowserCache[Browser Cache]
    end
    
    Source --> ViteBuild
    ViteBuild --> Assets
    ViteBuild --> RemixBuild
    RemixBuild --> StaticFiles
    RemixBuild --> ServerFunctions
    
    StaticFiles --> Preview
    StaticFiles --> Production
    ServerFunctions --> Preview
    ServerFunctions --> Production
    
    Production --> EdgeCache
    EdgeCache --> CDNNodes
    CDNNodes --> BrowserCache
    
    style ViteBuild fill:#646cff
    style Production fill:#f38020
    style EdgeCache fill:#e8f5e8
```

### 3. Storage Architecture

```mermaid
graph LR
    subgraph "CloudFlare KV (Key-Value Store)"
        UserSessions[User Sessions]
        ChatHistory[Chat History]
        UserPreferences[User Preferences]
        APIKeys[API Keys]
    end
    
    subgraph "CloudFlare R2 (Object Storage)"
        ProjectFiles[Project Files]
        Backups[Backups]
        StaticAssets[Static Assets]
        Logs[Application Logs]
    end
    
    subgraph "Browser Storage"
        LocalStorage[Local Storage]
        IndexedDB[IndexedDB]
        SessionStorage[Session Storage]
    end
    
    UserSessions --> LocalStorage
    ChatHistory --> IndexedDB
    UserPreferences --> LocalStorage
    
    ProjectFiles --> IndexedDB
    StaticAssets --> SessionStorage
    
    style UserSessions fill:#f38020
    style ProjectFiles fill:#f38020
    style LocalStorage fill:#e3f2fd
    style IndexedDB fill:#e3f2fd
```

## Deployment Environments

### Development Environment

```mermaid
graph TB
    subgraph "Local Development"
        ViteDevServer[Vite Dev Server]
        RemixDevServer[Remix Dev Server]
        Wrangler[Wrangler CLI]
        LocalWorkers[Local Workers]
    end
    
    subgraph "Development Services"
        LocalAPI[Local API Endpoints]
        MockServices[Mock External Services]
        DevDatabase[Development Database]
        HotReload[Hot Module Replacement]
    end
    
    ViteDevServer --> LocalAPI
    RemixDevServer --> ViteDevServer
    Wrangler --> LocalWorkers
    LocalWorkers --> MockServices
    
    LocalAPI --> DevDatabase
    ViteDevServer --> HotReload
    
    style ViteDevServer fill:#646cff
    style RemixDevServer fill:#000000,color:#ffffff
    style Wrangler fill:#f38020
```

**Development Features:**
- Hot module replacement for instant feedback
- Local Workers simulation via Wrangler
- Mock external services for offline development
- Source map support for debugging

### Staging Environment

```mermaid
graph TB
    subgraph "Staging Infrastructure"
        StagingWorkers[Staging Workers]
        StagingPages[Staging Pages]
        StagingKV[Staging KV Store]
        StagingDomain[staging.openbolt.new]
    end
    
    subgraph "Testing Services"
        TestAPI[Test API Keys]
        TestData[Test Data Sets]
        QAEnvironment[QA Environment]
        PerformanceTesting[Performance Testing]
    end
    
    StagingWorkers --> TestAPI
    StagingPages --> StagingDomain
    StagingKV --> TestData
    
    StagingWorkers --> QAEnvironment
    StagingPages --> PerformanceTesting
    
    style StagingWorkers fill:#f38020
    style StagingPages fill:#f38020
    style QAEnvironment fill:#fff3e0
```

### Production Environment

```mermaid
graph TB
    subgraph "Production Infrastructure"
        ProdWorkers[Production Workers]
        ProdPages[Production Pages]
        ProdKV[Production KV Store]
        ProdR2[Production R2 Storage]
        ProdDomain[openbolt.new]
    end
    
    subgraph "Production Services"
        LoadBalancer[Global Load Balancer]
        SSL[SSL Certificates]
        DDoSProtection[DDoS Protection]
        Firewall[Web Application Firewall]
    end
    
    subgraph "Monitoring & Analytics"
        CloudFlareAnalytics[CloudFlare Analytics]
        WorkerAnalytics[Worker Analytics]
        RealUserMonitoring[Real User Monitoring]
        ErrorTracking[Error Tracking]
    end
    
    ProdDomain --> LoadBalancer
    LoadBalancer --> SSL
    SSL --> DDoSProtection
    DDoSProtection --> Firewall
    Firewall --> ProdWorkers
    Firewall --> ProdPages
    
    ProdWorkers --> ProdKV
    ProdWorkers --> ProdR2
    
    ProdWorkers --> CloudFlareAnalytics
    ProdPages --> WorkerAnalytics
    ProdWorkers --> RealUserMonitoring
    ProdWorkers --> ErrorTracking
    
    style ProdWorkers fill:#f38020
    style ProdPages fill:#f38020
    style LoadBalancer fill:#e8f5e8
    style SSL fill:#e8f5e8
```

## CI/CD Pipeline

```mermaid
graph LR
    subgraph "Source Control"
        GitPush[Git Push]
        PullRequest[Pull Request]
        MainBranch[Main Branch]
    end
    
    subgraph "CI Pipeline"
        Tests[Run Tests]
        Lint[Lint & Format]
        Build[Build Application]
        SecurityScan[Security Scan]
    end
    
    subgraph "Deployment"
        StagingDeploy[Deploy to Staging]
        ProductionDeploy[Deploy to Production]
        Rollback[Rollback Option]
    end
    
    subgraph "Post-Deployment"
        SmokeTests[Smoke Tests]
        HealthChecks[Health Checks]
        Monitoring[Enable Monitoring]
    end
    
    GitPush --> Tests
    PullRequest --> Tests
    Tests --> Lint
    Lint --> Build
    Build --> SecurityScan
    
    SecurityScan --> StagingDeploy
    StagingDeploy --> SmokeTests
    SmokeTests --> ProductionDeploy
    
    MainBranch --> ProductionDeploy
    ProductionDeploy --> HealthChecks
    HealthChecks --> Monitoring
    
    ProductionDeploy --> Rollback
    
    style Tests fill:#e8f5e8
    style Build fill:#646cff
    style ProductionDeploy fill:#f38020
```

### Deployment Scripts

**Development:**
```bash
pnpm run dev          # Start local development server
pnpm run dev:workers  # Start local Workers development
```

**Building:**
```bash
pnpm run build        # Build for production
pnpm run typecheck    # TypeScript validation
pnpm run lint         # Code quality checks
```

**Deployment:**
```bash
pnpm run deploy:staging    # Deploy to staging
pnpm run deploy:production # Deploy to production
wrangler deploy           # Direct Worker deployment
```

## Performance Characteristics

### Global Performance

```mermaid
graph TB
    subgraph "Performance Metrics"
        TTFB[Time to First Byte]
        FCP[First Contentful Paint]
        LCP[Largest Contentful Paint]
        CLS[Cumulative Layout Shift]
        FID[First Input Delay]
    end
    
    subgraph "Edge Optimization"
        EdgeCache[Edge Caching]
        Minification[Asset Minification]
        Compression[Gzip/Brotli Compression]
        ImageOptimization[Image Optimization]
    end
    
    subgraph "Runtime Optimization"
        WorkerPerformance[Worker Performance]
        StreamingResponses[Streaming Responses]
        LazyLoading[Lazy Loading]
        CodeSplitting[Code Splitting]
    end
    
    EdgeCache --> TTFB
    Minification --> FCP
    Compression --> LCP
    LazyLoading --> CLS
    WorkerPerformance --> FID
    
    StreamingResponses --> TTFB
    CodeSplitting --> FCP
    ImageOptimization --> LCP
    
    style TTFB fill:#e8f5e8
    style EdgeCache fill:#f38020
    style StreamingResponses fill:#fff3e0
```

### Scaling Strategy

```mermaid
graph LR
    subgraph "Automatic Scaling"
        RequestVolume[Request Volume]
        EdgeDistribution[Edge Distribution]
        WorkerInstances[Worker Instances]
    end
    
    subgraph "Resource Management"
        CPUThrottling[CPU Throttling]
        MemoryLimits[Memory Limits]
        ExecutionTime[Execution Time Limits]
    end
    
    subgraph "Load Distribution"
        GeographicRouting[Geographic Routing]
        LoadBalancing[Load Balancing]
        FailoverLogic[Failover Logic]
    end
    
    RequestVolume --> EdgeDistribution
    EdgeDistribution --> WorkerInstances
    WorkerInstances --> CPUThrottling
    WorkerInstances --> MemoryLimits
    WorkerInstances --> ExecutionTime
    
    EdgeDistribution --> GeographicRouting
    GeographicRouting --> LoadBalancing
    LoadBalancing --> FailoverLogic
    
    style RequestVolume fill:#e3f2fd
    style EdgeDistribution fill:#f38020
    style LoadBalancing fill:#e8f5e8
```

## Security Architecture

### Security Layers

```mermaid
graph TB
    subgraph "Edge Security"
        DDoSMitigation[DDoS Mitigation]
        WAF[Web Application Firewall]
        RateLimiting[Rate Limiting]
        BotManagement[Bot Management]
    end
    
    subgraph "Application Security"
        Authentication[Authentication]
        Authorization[Authorization]
        InputValidation[Input Validation]
        OutputSanitization[Output Sanitization]
    end
    
    subgraph "Data Security"
        Encryption[Data Encryption]
        KeyManagement[Key Management]
        SecureStorage[Secure Storage]
        DataPrivacy[Data Privacy]
    end
    
    DDoSMitigation --> Authentication
    WAF --> InputValidation
    RateLimiting --> Authorization
    BotManagement --> OutputSanitization
    
    Authentication --> Encryption
    Authorization --> KeyManagement
    InputValidation --> SecureStorage
    OutputSanitization --> DataPrivacy
    
    style DDoSMitigation fill:#ffebee
    style Authentication fill:#fff3e0
    style Encryption fill:#e8f5e8
```

## Monitoring and Observability

```mermaid
graph TB
    subgraph "Metrics Collection"
        WorkerMetrics[Worker Metrics]
        PageMetrics[Page Metrics]
        UserMetrics[User Metrics]
        PerformanceMetrics[Performance Metrics]
    end
    
    subgraph "Logging"
        AccessLogs[Access Logs]
        ErrorLogs[Error Logs]
        ApplicationLogs[Application Logs]
        SecurityLogs[Security Logs]
    end
    
    subgraph "Alerting"
        Thresholds[Alert Thresholds]
        Notifications[Notifications]
        Escalation[Escalation Policies]
        Runbooks[Incident Runbooks]
    end
    
    subgraph "Dashboards"
        RealTimeDashboard[Real-time Dashboard]
        HistoricalAnalysis[Historical Analysis]
        UserBehavior[User Behavior Analytics]
        BusinessMetrics[Business Metrics]
    end
    
    WorkerMetrics --> AccessLogs
    PageMetrics --> ErrorLogs
    UserMetrics --> ApplicationLogs
    PerformanceMetrics --> SecurityLogs
    
    AccessLogs --> Thresholds
    ErrorLogs --> Notifications
    ApplicationLogs --> Escalation
    SecurityLogs --> Runbooks
    
    Thresholds --> RealTimeDashboard
    Notifications --> HistoricalAnalysis
    Escalation --> UserBehavior
    Runbooks --> BusinessMetrics
    
    style WorkerMetrics fill:#f38020
    style Thresholds fill:#fff3e0
    style RealTimeDashboard fill:#e8f5e8
```

This deployment architecture provides:
- **Global performance** through edge computing
- **Automatic scaling** based on demand
- **High availability** with built-in redundancy
- **Security** at multiple layers
- **Observability** for proactive monitoring
- **Cost efficiency** through serverless pricing