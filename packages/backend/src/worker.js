// 输入验证函数
function validateCourse(course) {
  if (!course.name || typeof course.name !== 'string' || course.name.trim() === '') {
    throw new Error('课程名称不能为空');
  }
  
  if (!course.regular_score || isNaN(course.regular_score) || 
      course.regular_score < 0 || course.regular_score > 100) {
    throw new Error('平时成绩必须在0-100之间');
  }
  
  const examScores = JSON.parse(course.exam_scores);
  if (!Array.isArray(examScores) || examScores.length === 0) {
    throw new Error('至少需要一个考试成绩');
  }
  
  for (const score of examScores) {
    if (isNaN(score) || score < 0 || score > 100) {
      throw new Error('考试成绩必须在0-100之间');
    }
  }
}

// 速率限制Map
const ipRequestCounts = new Map();

// 速率限制检查函数
function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60000; // 1分钟窗口
  const maxRequests = 60; // 每分钟最大请求数
  
  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, []);
  }
  
  const requests = ipRequestCounts.get(ip);
  const windowStart = now - windowMs;
  
  // 清理旧的请求记录
  while (requests.length > 0 && requests[0] < windowStart) {
    requests.shift();
  }
  
  if (requests.length >= maxRequests) {
    throw new Error('请求过于频繁，请稍后再试');
  }
  
  requests.push(now);
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };

    try {
      // 获取客户端IP
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      // 检查速率限制
      checkRateLimit(clientIP);
      
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (path === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected websocket', { status: 400 });
        }
        
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        server.accept();
        
        try {
          const { results } = await env.DB.prepare(
            'SELECT * FROM courses ORDER BY created_at DESC'
          ).all();
          server.send(JSON.stringify({ type: 'init', courses: results }));
        } catch (error) {
          server.send(JSON.stringify({
            type: 'error',
            message: '获取课程列表失败'
          }));
        }
        
        server.addEventListener('message', async (event) => {
          try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
              case 'add':
                const course = data.course;
                validateCourse(course);
                
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
                } else {
                  throw new Error('添加课程失败');
                }
                break;
                
              case 'delete':
                if (!data.id || isNaN(data.id)) {
                  throw new Error('无效的课程ID');
                }
                
                const result = await env.DB.prepare(
                  'DELETE FROM courses WHERE id = ?'
                ).bind(data.id).run();
                
                if (result.success) {
                  server.send(JSON.stringify({
                    type: 'deleted',
                    id: data.id
                  }));
                } else {
                  throw new Error('删除课程失败');
                }
                break;
            }
          } catch (error) {
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
          try {
            const { results } = await env.DB.prepare(
              'SELECT * FROM courses ORDER BY created_at DESC'
            ).all();
            
            return new Response(JSON.stringify(results), {
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...corsHeaders
              }
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: '获取课程列表失败' }), {
              status: 500,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...corsHeaders
              }
            });
          }
        }
        
        if (request.method === 'POST') {
          try {
            const data = await request.json();
            validateCourse(data);
            
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
                  'Content-Type': 'application/json; charset=utf-8',
                  ...corsHeaders
                }
              });
            } else {
              throw new Error('添加课程失败');
            }
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...corsHeaders
              }
            });
          }
        }
      }
      
      if (path.startsWith('/api/courses/') && request.method === 'DELETE') {
        try {
          const id = parseInt(path.split('/').pop());
          if (isNaN(id)) {
            throw new Error('无效的课程ID');
          }
          
          const result = await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
          if (result.success) {
            return new Response(null, {
              headers: corsHeaders
            });
          } else {
            throw new Error('删除课程失败');
          }
        } catch (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              ...corsHeaders
            }
          });
        }
      }
      
      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.message.includes('请求过于频繁') ? 429 : 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders
        }
      });
    }
  }
};
