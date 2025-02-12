export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') {
      // WebSocket 连接处理
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      server.accept();
      
      // 发送初始数据
      const { results } = await env.DB.prepare(
        'SELECT * FROM courses ORDER BY created_at DESC'
      ).all();
      server.send(JSON.stringify({ type: 'init', courses: results }));
      
      // 处理消息
      server.addEventListener('message', async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'add':
              const course = data.course;
              const { success, meta } = await env.DB.prepare(
                'INSERT INTO courses (name, regular_score, exam_scores, final_score, gpa) VALUES (?, ?, ?, ?, ?)'
              ).bind(
                course.name,
                course.regular_score,
                course.exam_scores,
                course.final_score,
                course.gpa
              ).run();
              
              if (success) {
                server.send(JSON.stringify({
                  type: 'added',
                  course: { ...course, id: meta.last_row_id }
                }));
              }
              break;
              
            case 'delete':
              await env.DB.prepare(
                'DELETE FROM courses WHERE id = ?'
              ).bind(data.id).run();
              
              server.send(JSON.stringify({
                type: 'deleted',
                id: data.id
              }));
              break;
          }
        } catch (error) {
          console.error('Error processing message:', error);
          server.send(JSON.stringify({
            type: 'error',
            message: error.message
          }));
        }
      });
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (path === '/api/courses') {
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM courses ORDER BY created_at DESC'
        ).all();
        
        return new Response(JSON.stringify(results), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      if (request.method === 'POST') {
        const data = await request.json();
        const { success, meta } = await env.DB.prepare(
          'INSERT INTO courses (name, regular_score, exam_scores, final_score, gpa) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          data.name,
          data.regular_score,
          data.exam_scores,
          data.final_score || 0,
          data.gpa || 0
        ).run();
        
        if (success) {
          const course = {
            id: meta.last_row_id,
            ...data
          };
          return new Response(JSON.stringify(course), {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
      }
    }
    
    if (path.startsWith('/api/courses/') && request.method === 'DELETE') {
      const id = parseInt(path.split('/').pop());
      await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
      return new Response(null, {
        headers: corsHeaders
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
