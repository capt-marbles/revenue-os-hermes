"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Eye, EyeOff, Save, Key, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";

interface SecretConfig {
  key: string;
  placeholder: string;
  description: string;
  configured: boolean;
  hasValue: boolean;
}

export function SecretsForm() {
  const [secrets, setSecrets] = useState<SecretConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSecrets();
  }, []);

  const fetchSecrets = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings/secrets");
      if (!res.ok) throw new Error("Failed to load secrets");
      const data = await res.json();
      
      // Set up values with masked values for configured secrets
      const initialValues: Record<string, string> = {};
      const initialOriginalValues: Record<string, string> = {};
      
      data.forEach((secret: SecretConfig) => {
        if (secret.configured) {
          // Mask the actual value
          initialValues[secret.key] = "***configured***";
          initialOriginalValues[secret.key] = "***masked***";
        } else {
          initialValues[secret.key] = "";
          initialOriginalValues[secret.key] = "";
        }
      });
      
      setSecrets(data);
      setValues(initialValues);
      setOriginalValues(initialOriginalValues);
    } catch (error) {
      console.error("Failed to load secrets:", error);
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (key: string) => {
    try {
      setSaving(key);
      const value = values[key]?.trim();
      
      if (!value) {
        toast.error("API key cannot be empty");
        return;
      }
      
      const res = await fetch("/api/settings/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      
      if (!res.ok) throw new Error("Failed to save secret");
      
      // Update local state to show configured
      setSecrets(prev => 
        prev.map(secret => 
          secret.key === key 
            ? { ...secret, configured: true, hasValue: true }
            : secret
        )
      );
      
      // Mask the saved value
      setValues(prev => ({
        ...prev,
        [key]: "***configured***"
      }));
      
      toast.success("API key saved successfully");
      
    } catch (error) {
      console.error("Failed to save secret:", error);
      toast.error("Failed to save API key");
    } finally {
      setSaving(null);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    // If user wants to update, let them override the masked value
    setValues(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const togglePassword = (key: string) => {
    setShowPasswords(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getConnectorCategory = (key: string) => {
    if (key.includes("MATON")) return "Google Workspace";
    if (key.includes("TWENTY")) return "CRM";
    if (key.includes("HUNTER") || key.includes("APOLLO")) return "Prospecting";
    return "Other";
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>
            Manage API keys for integrated services
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const groupedSecrets = secrets.reduce((groups, secret) => {
    const category = getConnectorCategory(secret.key);
    if (!groups[category]) groups[category] = [];
    groups[category].push(secret);
    return groups;
  }, {} as Record<string, SecretConfig[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Keys
        </CardTitle>
        <CardDescription>
          Manage API keys for integrated services
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {Object.entries(groupedSecrets).map(([category, categorySecrets]) => (
            <div key={category} className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {category}
              </h3>
              <div className="space-y-4">
                {categorySecrets.map((secret) => (
                  <div key={secret.key} className="flex items-end gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor={secret.key} className="text-sm">
                        <span className="font-medium">{secret.key}</span>
                        {secret.configured && (
                          <CheckCircle className="inline-block ml-2 h-4 w-4 text-emerald-600" />
                        )}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {secret.description}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <div className="relative">
                        <Input
                          id={secret.key}
                          type={showPasswords[secret.key] ? "text" : "password"}
                          placeholder={secret.configured ? "Configured" : secret.placeholder}
                          value={values[secret.key] || ""}
                          onChange={(e) => handleInputChange(secret.key, e.target.value)}
                          className="w-80"
                          disabled={saving === secret.key}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => togglePassword(secret.key)}
                          type="button"
                        >
                          {showPasswords[secret.key] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <Button
                        onClick={() => handleSave(secret.key)}
                        disabled={saving === secret.key || !values[secret.key]?.trim()}
                        className="w-20"
                      >
                        {saving === secret.key ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 pt-6 border-t">
          <p className="text-xs text-muted-foreground">
            Keys are stored encrypted in ~/.hermes/secrets.env and survive Revenue OS updates.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}