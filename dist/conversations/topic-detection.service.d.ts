export declare class TopicDetectionService {
    private readonly keywordMap;
    detectTopic(text: string): string;
    extractKeywords(text: string, topic: string): string[];
    getAvailableTopics(): string[];
}
