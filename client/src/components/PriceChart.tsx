import React from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

interface PricePoint {
  price: number;
  timestamp: string;
}

interface PriceChartProps {
  data: PricePoint[];
}

const PriceChart: React.FC<PriceChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return <div style={{ color: '#666', fontSize: '0.8rem', padding: '20px' }}>データ収集中...</div>;
  }

  const chartData = data.map(point => ({
    price: point.price,
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    fullDate: new Date(point.timestamp).toLocaleString()
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ff4d4d" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#ff4d4d" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" vertical={false} />
        <XAxis 
          dataKey="time" 
          stroke="#666" 
          fontSize={10} 
          tickLine={false}
          axisLine={false}
        />
        <YAxis 
          stroke="#666" 
          fontSize={10} 
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `¥${value.toLocaleString()}`}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#16161e', 
            border: '1px solid #2a2a35',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#f0f0f5'
          }}
          itemStyle={{ color: '#ff4d4d' }}
          labelStyle={{ marginBottom: '4px' }}
        />
        <Area 
          type="monotone" 
          dataKey="price" 
          stroke="#ff4d4d" 
          strokeWidth={2}
          fillOpacity={1} 
          fill="url(#colorPrice)" 
          animationDuration={1500}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default PriceChart;
