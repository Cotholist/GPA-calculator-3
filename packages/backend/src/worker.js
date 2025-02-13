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

// 计算GPA的函数
async function calculateGPA(score, env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT gpa_value FROM gpa_rules WHERE ? BETWEEN min_score AND max_score'
    ).bind(score).all();
    
    return results.length > 0 ? results[0].gpa_value : 0;
  } catch (error) {
    console.error('计算GPA时出错:', error);
    return 0;
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

// 验证Cloudflare Access JWT令牌
async function validateJWT(request, env) {
  try {
    // 获取CF Access验证信息
    const cfAccessEmail = request.headers.get('cf-access-authenticated-user-email');
    const cfAccessJWT = request.headers.get('cf-access-jwt-assertion');
    
    if (!cfAccessEmail || !cfAccessJWT) {
      throw new Error('未经授权的访问');
    }

    // 验证JWT令牌
    const audience = env.CF_ACCESS_AUD;
    const response = await fetch('https://hankgpa.cloudflareaccess.com/cdn-cgi/access/certs', {
      cf: {
        cacheTtl: 12 * 60 * 60,
        cacheEverything: true,
      },
    });
    
    if (!response.ok) {
      throw new Error('无法获取验证密钥');
    }

    // 将用户信息添加到请求中
    request.user = {
      email: cfAccessEmail,
      jwt: cfAccessJWT
    };

    return true;
  } catch (error) {
    console.error('JWT验证失败:', error);
    return false;
  }
}

export default {
  async fetch(request, env) {
    // 获取请求的origin
    const origin = request.headers.get('Origin');
    
    // 验证origin是否是允许的域名
    const allowedOrigins = [
      'https://59a1f0ce.gpa-calculator-3.pages.dev',
      'https://gpa-calculator-3.pages.dev',
      'http://localhost:8787',  // 本地开发用
    ];
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, CF-Access-Client-Id, CF-Access-Client-Secret',
      'Access-Control-Allow-Credentials': 'true',
      'Content-Type': 'application/json; charset=utf-8'
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        headers: corsHeaders
      });
    }

    try {
      // 如果是WebSocket连接，跳过JWT验证
      if (!request.url.endsWith('/ws')) {
        // 暂时注释掉JWT验证，等Cloudflare Access配置完成后再启用
        /*
        const isValid = await validateJWT(request, env);
        if (!isValid) {
          return new Response(JSON.stringify({
            error: '未经授权的访问'
          }), {
            status: 401,
            headers: corsHeaders
          });
        }
        */
      }

      // 获取客户端IP
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      // 检查速率限制
      checkRateLimit(clientIP);
      
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
          // 获取用户特定的课程列表
          const userEmail = request.headers.get('cf-access-authenticated-user-email');
          const { results } = await env.DB.prepare(
            'SELECT * FROM courses WHERE user_email = ? ORDER BY created_at DESC'
          ).bind(userEmail).all();
          
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
              case 'add_course': {
                validateCourse(data.course);
                
                const examScores = JSON.parse(data.course.exam_scores);
                const regularScore = parseFloat(data.course.regular_score);
                const examAverage = examScores.reduce((a, b) => a + parseFloat(b), 0) / examScores.length;
                
                // 计算最终成绩 (40% 平时成绩 + 60% 考试平均分)
                const finalScore = regularScore * 0.4 + examAverage * 0.6;
                
                // 计算GPA
                const gpa = await calculateGPA(finalScore, env);
                
                const { success } = await env.DB.prepare(`
                  INSERT INTO courses (name, regular_score, exam_scores, final_score, gpa, user_email)
                  VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                  data.course.name,
                  regularScore,
                  data.course.exam_scores,
                  finalScore,
                  gpa,
                  request.user.email
                ).run();
                
                if (!success) {
                  throw new Error('添加课程失败');
                }
                
                // 获取更新后的课程列表（按最终成绩降序排序）
                const { results } = await env.DB.prepare(
                  'SELECT * FROM courses WHERE user_email = ? ORDER BY final_score DESC'
                ).bind(request.user.email).all();
                
                // 广播更新后的课程列表
                server.send(JSON.stringify({
                  type: 'update',
                  courses: results
                }));
                break;
              }
              
              case 'get_rules': {
                const { results } = await env.DB.prepare(
                  'SELECT * FROM gpa_rules ORDER BY min_score DESC'
                ).all();
                
                server.send(JSON.stringify({
                  type: 'rules',
                  rules: results
                }));
                break;
              }
              
              case 'update_rules': {
                const rules = data.rules;
                
                // 验证规则
                if (!Array.isArray(rules)) {
                  throw new Error('无效的GPA规则格式');
                }
                
                // 开始事务
                await env.DB.prepare('BEGIN TRANSACTION').run();
                
                try {
                  // 清空现有规则
                  await env.DB.prepare('DELETE FROM gpa_rules').run();
                  
                  // 插入新规则
                  for (const rule of rules) {
                    await env.DB.prepare(`
                      INSERT INTO gpa_rules (min_score, max_score, gpa_value)
                      VALUES (?, ?, ?)
                    `).bind(rule.min_score, rule.max_score, rule.gpa_value).run();
                  }
                  
                  // 提交事务
                  await env.DB.prepare('COMMIT').run();
                  
                  // 重新计算所有课程的GPA
                  const courses = await env.DB.prepare('SELECT * FROM courses').all();
                  for (const course of courses.results) {
                    const gpa = await calculateGPA(course.final_score, env);
                    await env.DB.prepare('UPDATE courses SET gpa = ? WHERE id = ?')
                      .bind(gpa, course.id).run();
                  }
                  
                  // 获取更新后的课程列表
                  const { results } = await env.DB.prepare(
                    'SELECT * FROM courses WHERE user_email = ? ORDER BY final_score DESC'
                  ).bind(request.user.email).all();
                  
                  // 广播更新
                  server.send(JSON.stringify({
                    type: 'update',
                    courses: results
                  }));
                  
                } catch (error) {
                  // 回滚事务
                  await env.DB.prepare('ROLLBACK').run();
                  throw error;
                }
                break;
              }
              
              case 'delete_course': {
                if (!data.id || isNaN(data.id)) {
                  throw new Error('无效的课程ID');
                }
                
                const result = await env.DB.prepare(
                  'DELETE FROM courses WHERE id = ? AND user_email = ?'
                ).bind(data.id, request.user.email).run();
                
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
              'SELECT * FROM courses WHERE user_email = ? ORDER BY created_at DESC'
            ).bind(request.user.email).all();
            
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
            
            const examScores = JSON.parse(data.exam_scores);
            const regularScore = parseFloat(data.regular_score);
            const examAverage = examScores.reduce((a, b) => a + parseFloat(b), 0) / examScores.length;
            
            // 计算最终成绩 (40% 平时成绩 + 60% 考试平均分)
            const finalScore = regularScore * 0.4 + examAverage * 0.6;
            
            // 计算GPA
            const gpa = await calculateGPA(finalScore, env);
            
            const { success, meta } = await env.DB.prepare(
              'INSERT INTO courses (name, regular_score, exam_scores, final_score, gpa, user_email) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(
              data.name,
              regularScore,
              data.exam_scores,
              finalScore,
              gpa,
              request.user.email
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
          
          const result = await env.DB.prepare(
            'DELETE FROM courses WHERE id = ? AND user_email = ?'
          ).bind(id, request.user.email).run();
          
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
