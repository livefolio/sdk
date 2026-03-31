export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      allocations: {
        Row: {
          created_at: string;
          holdings: Json;
          id: number;
        };
        Insert: {
          created_at?: string;
          holdings: Json;
          id?: number;
        };
        Update: {
          created_at?: string;
          holdings?: Json;
          id?: number;
        };
        Relationships: [];
      };
      indicators: {
        Row: {
          created_at: string;
          delay: number;
          id: number;
          lookback: number;
          threshold: number | null;
          ticker_id: number | null;
          type: Database['public']['Enums']['indicator_type'];
          unit: Database['public']['Enums']['unit'] | null;
        };
        Insert: {
          created_at?: string;
          delay: number;
          id?: number;
          lookback: number;
          threshold?: number | null;
          ticker_id?: number | null;
          type: Database['public']['Enums']['indicator_type'];
          unit?: Database['public']['Enums']['unit'] | null;
        };
        Update: {
          created_at?: string;
          delay?: number;
          id?: number;
          lookback?: number;
          threshold?: number | null;
          ticker_id?: number | null;
          type?: Database['public']['Enums']['indicator_type'];
          unit?: Database['public']['Enums']['unit'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'indicators_ticker_id_fkey';
            columns: ['ticker_id'];
            isOneToOne: false;
            referencedRelation: 'tickers';
            referencedColumns: ['id'];
          },
        ];
      };
      indicators_series: {
        Row: {
          id: number;
          indicator_id: number;
          metadata: Json | null;
          trading_day_id: number;
          value: number;
        };
        Insert: {
          id?: number;
          indicator_id: number;
          metadata?: Json | null;
          trading_day_id: number;
          value: number;
        };
        Update: {
          id?: number;
          indicator_id?: number;
          metadata?: Json | null;
          trading_day_id?: number;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'indicators_series_indicator_id_fkey';
            columns: ['indicator_id'];
            isOneToOne: false;
            referencedRelation: 'indicators';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'indicators_series_trading_day_id_fkey';
            columns: ['trading_day_id'];
            isOneToOne: false;
            referencedRelation: 'trading_days';
            referencedColumns: ['id'];
          },
        ];
      };
      signals: {
        Row: {
          comparison: Database['public']['Enums']['comparison'];
          created_at: string;
          id: number;
          indicator_id_1: number;
          indicator_id_2: number;
          tolerance: number;
        };
        Insert: {
          comparison: Database['public']['Enums']['comparison'];
          created_at?: string;
          id?: number;
          indicator_id_1: number;
          indicator_id_2: number;
          tolerance: number;
        };
        Update: {
          comparison?: Database['public']['Enums']['comparison'];
          created_at?: string;
          id?: number;
          indicator_id_1?: number;
          indicator_id_2?: number;
          tolerance?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'signals_indicator_id_1_fkey';
            columns: ['indicator_id_1'];
            isOneToOne: false;
            referencedRelation: 'indicators';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'signals_indicator_id_2_fkey';
            columns: ['indicator_id_2'];
            isOneToOne: false;
            referencedRelation: 'indicators';
            referencedColumns: ['id'];
          },
        ];
      };
      signals_series: {
        Row: {
          id: number;
          signal_id: number;
          trading_day_id: number;
          value: boolean;
        };
        Insert: {
          id?: number;
          signal_id: number;
          trading_day_id: number;
          value: boolean;
        };
        Update: {
          id?: number;
          signal_id?: number;
          trading_day_id?: number;
          value?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'signals_series_signal_id_fkey';
            columns: ['signal_id'];
            isOneToOne: false;
            referencedRelation: 'signals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'signals_series_trading_day_id_fkey';
            columns: ['trading_day_id'];
            isOneToOne: false;
            referencedRelation: 'trading_days';
            referencedColumns: ['id'];
          },
        ];
      };
      strategies: {
        Row: {
          created_at: string;
          definition: Json | null;
          id: number;
          link_id: string;
          name: string;
          trading_freq: Database['public']['Enums']['trading_freq'];
          trading_offset: number;
        };
        Insert: {
          created_at?: string;
          definition?: Json | null;
          id?: number;
          link_id: string;
          name: string;
          trading_freq?: Database['public']['Enums']['trading_freq'];
          trading_offset?: number;
        };
        Update: {
          created_at?: string;
          definition?: Json | null;
          id?: number;
          link_id?: string;
          name?: string;
          trading_freq?: Database['public']['Enums']['trading_freq'];
          trading_offset?: number;
        };
        Relationships: [];
      };
      strategies_series: {
        Row: {
          allocation_id: number;
          id: number;
          strategies_id: number;
          trading_day_id: number;
        };
        Insert: {
          allocation_id: number;
          id?: number;
          strategies_id: number;
          trading_day_id: number;
        };
        Update: {
          allocation_id?: number;
          id?: number;
          strategies_id?: number;
          trading_day_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'strategies_series_allocation_id_fkey';
            columns: ['allocation_id'];
            isOneToOne: false;
            referencedRelation: 'allocations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'strategies_series_strategies_id_fkey';
            columns: ['strategies_id'];
            isOneToOne: false;
            referencedRelation: 'strategies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'strategies_series_trading_day_id_fkey';
            columns: ['trading_day_id'];
            isOneToOne: false;
            referencedRelation: 'trading_days';
            referencedColumns: ['id'];
          },
        ];
      };
      tickers: {
        Row: {
          created_at: string;
          id: number;
          leverage: number;
          symbol: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          leverage: number;
          symbol: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          leverage?: number;
          symbol?: string;
        };
        Relationships: [];
      };
      trading_days: {
        Row: {
          close: string;
          date: string;
          id: number;
          overnight: string;
          post: string;
          pre: string;
          regular: string;
        };
        Insert: {
          close: string;
          date: string;
          id?: number;
          overnight: string;
          post: string;
          pre: string;
          regular: string;
        };
        Update: {
          close?: string;
          date?: string;
          id?: number;
          overnight?: string;
          post?: string;
          pre?: string;
          regular?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      comparison: '>' | '<' | '=';
      indicator_type:
        | 'SMA'
        | 'EMA'
        | 'Price'
        | 'Return'
        | 'Volatility'
        | 'Drawdown'
        | 'RSI'
        | 'VIX'
        | 'VIX3M'
        | 'T3M'
        | 'T6M'
        | 'T1Y'
        | 'T2Y'
        | 'T3Y'
        | 'T5Y'
        | 'T7Y'
        | 'T10Y'
        | 'T20Y'
        | 'T30Y'
        | 'Month'
        | 'Day of Week'
        | 'Day of Month'
        | 'Day of Year'
        | 'Threshold';
      trading_freq:
        | 'Daily'
        | 'Weekly'
        | 'Monthly'
        | 'Bi-monthly'
        | 'Quarterly'
        | 'Every 4 Months'
        | 'Semiannually'
        | 'Yearly';
      unit: '%' | '$';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      comparison: ['>', '<', '='],
      indicator_type: [
        'SMA',
        'EMA',
        'Price',
        'Return',
        'Volatility',
        'Drawdown',
        'RSI',
        'VIX',
        'VIX3M',
        'T3M',
        'T6M',
        'T1Y',
        'T2Y',
        'T3Y',
        'T5Y',
        'T7Y',
        'T10Y',
        'T20Y',
        'T30Y',
        'Month',
        'Day of Week',
        'Day of Month',
        'Day of Year',
        'Threshold',
      ],
      trading_freq: [
        'Daily',
        'Weekly',
        'Monthly',
        'Bi-monthly',
        'Quarterly',
        'Every 4 Months',
        'Semiannually',
        'Yearly',
      ],
      unit: ['%', '$'],
    },
  },
} as const;
