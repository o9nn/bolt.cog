import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { cognitiveAgentIntegration } from '~/lib/cognitive/integration';

export async function action({ request }: ActionFunctionArgs) {
  const { action: actionType, payload } = await request.json<{
    action: 'status' | 'query' | 'plan' | 'share_knowledge';
    payload?: any;
  }>();

  try {
    switch (actionType) {
      case 'status': {
        const status = await cognitiveAgentIntegration.getNetworkStatus();
        return json({ success: true, data: status });
      }

      case 'query': {
        const { question } = payload;
        if (!question) {
          return json({ success: false, error: 'Question is required' }, { status: 400 });
        }
        
        const answer = await cognitiveAgentIntegration.queryContext(question);
        return json({ success: true, data: { answer } });
      }

      case 'plan': {
        const { task } = payload;
        if (!task) {
          return json({ success: false, error: 'Task is required' }, { status: 400 });
        }
        
        const plan = await cognitiveAgentIntegration.planTask(task);
        return json({ success: true, data: plan });
      }

      case 'share_knowledge': {
        const { content, type = 'fact' } = payload;
        if (!content) {
          return json({ success: false, error: 'Content is required' }, { status: 400 });
        }
        
        await cognitiveAgentIntegration.shareKnowledge(content, type);
        return json({ success: true, data: { message: 'Knowledge shared successfully' } });
      }

      default:
        return json({ success: false, error: 'Unknown action type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Cognitive agent API error:', error);
    return json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}