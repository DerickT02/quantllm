/**
 * ──────────────────────────────────────────────────────────────────────────────
 * N8N INTEGRATION SERVICE
 * ──────────────────────────────────────────────────────────────────────────────
 * Service for integrating with N8N workflow automation
 */

import axios from 'axios';

interface N8NConfig {
  webhookUrl?: string;
  apiUrl?: string;
  apiKey?: string;
}

interface AnalysisData {
  timestamp: string;
  narrative: string;
  data: any;
  candles: any[];
}

interface NotificationLevel {
  level: 'info' | 'warning' | 'error' | 'success';
}

export default class N8NIntegrationService {
  private config: N8NConfig;
  private isEnabled: boolean;

  constructor() {
    this.config = {
      webhookUrl: process.env.N8N_WEBHOOK_URL,
      apiUrl: process.env.N8N_API_URL,
      apiKey: process.env.N8N_API_KEY
    };
    
  this.isEnabled = this.isValidUrl(this.config.webhookUrl) || Boolean(this.config.apiUrl);
  }

  /**
   * Send analysis data to N8N webhook
   */
  async sendAnalysisToN8N(analysisData: AnalysisData): Promise<any> {
    if (!this.isEnabled || !this.isValidUrl(this.config.webhookUrl)) {
      console.warn('N8N integration not configured - skipping webhook call');
      return { success: false, message: 'N8N not configured' };
    }

    try {
  const response = await axios.post(this.config.webhookUrl as string, {
        type: 'analysis',
        timestamp: analysisData.timestamp,
        data: analysisData
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      console.error('Failed to send analysis to N8N:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send notification to N8N
   */
  async sendNotification(message: string, level: string = 'info', metadata?: any): Promise<any> {
    if (!this.isEnabled || !this.isValidUrl(this.config.webhookUrl)) {
      console.warn('N8N integration not configured - skipping notification');
      return { success: false, message: 'N8N not configured' };
    }

    try {
  const response = await axios.post(this.config.webhookUrl as string, {
        type: 'notification',
        message,
        level,
        timestamp: new Date().toISOString(),
        metadata
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      console.error('Failed to send notification to N8N:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test N8N connection
   */
  async testConnection(): Promise<any> {
    if (!this.isEnabled) {
      return {
        success: false,
        message: 'N8N integration not configured'
      };
    }

    try {
      const testData = {
        type: 'test',
        timestamp: new Date().toISOString(),
        message: 'QuantLLM connection test'
      };

      if (this.config.webhookUrl) {
        const response = await axios.post(this.config.webhookUrl, testData, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        return {
          success: true,
          status: response.status,
          message: 'Webhook connection successful'
        };
      }

      return {
        success: false,
        message: 'No webhook URL configured'
      };
    } catch (error) {
      console.error('N8N connection test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get N8N service status
   */
  getStatus(): any {
    return {
      enabled: this.isEnabled,
      configured: {
        webhook: this.isValidUrl(this.config.webhookUrl),
        api: Boolean(this.config.apiUrl && this.config.apiKey)
      },
      config: {
        hasWebhookUrl: Boolean(this.config.webhookUrl),
        hasApiUrl: Boolean(this.config.apiUrl),
        hasApiKey: Boolean(this.config.apiKey)
      }
    };
  }

  /**
   * Update webhook URL
   */
  updateWebhookUrl(url: string): boolean {
    try {
      // Basic URL validation
  new URL(url);
  this.config.webhookUrl = url;
  this.isEnabled = this.isValidUrl(this.config.webhookUrl) || Boolean(this.config.apiUrl);
      return true;
    } catch (error) {
      console.error('Invalid webhook URL:', error);
      return false;
    }
  }

  /**
   * Update API configuration
   */
  updateApiConfig(apiUrl: string, apiKey: string): boolean {
    try {
      // Basic URL validation
  new URL(apiUrl);
  this.config.apiUrl = apiUrl;
  this.config.apiKey = apiKey;
  this.isEnabled = this.isValidUrl(this.config.webhookUrl) || Boolean(this.config.apiUrl);
      return true;
    } catch (error) {
      console.error('Invalid API configuration:', error);
      return false;
    }
  }

  private isValidUrl(value?: string): boolean {
    if (!value) return false;
    try {
      const u = new URL(value);
      // Guard against placeholder text
      return !!u.protocol && !/your[-_]?n8n|your_/i.test(value);
    } catch {
      return false;
    }
  }
}