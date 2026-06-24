{{- define "dt-orch.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "dt-orch.registry" -}}
{{- .Values.global.registry -}}
{{- end }}

{{- define "dt-orch.imageTag" -}}
{{- .Values.global.imageTag -}}
{{- end }}

{{- define "dt-orch.apiImage" -}}
{{ printf "%s/%s:%s" (include "dt-orch.registry" .) .Values.api.image.repository (include "dt-orch.imageTag" .) }}
{{- end }}

{{- define "dt-orch.frontendImage" -}}
{{ printf "%s/%s:%s" (include "dt-orch.registry" .) .Values.frontend.image.repository (include "dt-orch.imageTag" .) }}
{{- end }}

{{- define "dt-orch.infraImage" -}}
{{ printf "%s/%s:%s" (include "dt-orch.registry" .) .Values.infra.image.repository (include "dt-orch.imageTag" .) }}
{{- end }}
