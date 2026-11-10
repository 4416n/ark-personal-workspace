export function fullstackFixture() {
  return {
    summary: "前后端笔记应用，SQLite 持久化，支持新增、列表和删除。",
    files: [
      {
        path: "src/main.jsx",
        content: `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import './styles.css';function App(){const[items,setItems]=useState([]),[title,setTitle]=useState('');const load=()=>fetch('/api/notes').then(r=>r.json()).then(setItems);useEffect(()=>{load()},[]);return <main><h1>我的笔记</h1><form onSubmit={async e=>{e.preventDefault();await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});setTitle('');load();}}><label>标题<input aria-label="标题" value={title} onChange={e=>setTitle(e.target.value)} required/></label><button>新增笔记</button></form><ul>{items.map(n=><li key={n.id}>{n.title}<button onClick={async()=>{await fetch('/api/notes/'+n.id,{method:'DELETE'});load()}}>删除</button></li>)}</ul></main>}createRoot(document.getElementById('root')).render(<App/>);`,
      },
      {
        path: "src/styles.css",
        content:
          "body{margin:0;font-family:system-ui;background:#f3f5f8;color:#273443}main{max-width:700px;margin:40px auto;padding:24px}form{display:flex;gap:12px;flex-wrap:wrap}input,button{padding:12px;border:1px solid #ccd4de;border-radius:6px}li{margin:18px 0;display:flex;justify-content:space-between;gap:12px;overflow-wrap:anywhere}h1{font-size:28px}",
      },
      {
        path: "server/app.mjs",
        content: `import{Router}from'express';import{DatabaseSync}from'node:sqlite';import path from'node:path';const db=new DatabaseSync(path.join(process.env.DATA_DIR||'./data','notes.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,title TEXT NOT NULL)');const api=Router();api.get('/notes',(_,res)=>res.json(db.prepare('SELECT * FROM notes ORDER BY id DESC').all()));api.post('/notes',(req,res)=>{if(typeof req.body.title!=='string'||!req.body.title.trim())return res.status(400).json({error:'title required'});const result=db.prepare('INSERT INTO notes(title) VALUES(?)').run(req.body.title.trim());res.status(201).json({id:Number(result.lastInsertRowid),title:req.body.title.trim()})});api.delete('/notes/:id',(req,res)=>{db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);res.json({ok:true})});export default api;`,
      },
      {
        path: "README.md",
        content:
          "# 笔记应用\n完整 React 前端 + Express 后端 + SQLite。启动：npm ci --ignore-scripts && npm run build && npm start。\n支持新增、读取、删除笔记。仅个人本机使用，无公网身份认证。数据库位于 DATA_DIR/notes.sqlite，部署说明见 DEPLOY.md。",
      },
    ],
    tests: {
      api: [
        {
          name: "创建笔记",
          method: "POST",
          path: "/api/notes",
          body: { title: "接口测试笔记" },
          status: 201,
          contains: "接口测试笔记",
        },
        {
          name: "读取笔记",
          method: "GET",
          path: "/api/notes",
          status: 200,
          contains: "接口测试笔记",
        },
      ],
      browser: [
        { action: "fill", selector: "input", value: "浏览器创建的笔记" },
        { action: "click", selector: "form button" },
        { action: "text", value: "浏览器创建的笔记" },
      ],
    },
  };
}
