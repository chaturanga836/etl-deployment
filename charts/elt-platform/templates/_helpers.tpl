{{- define "elt-platform.fullname" -}}
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

{{- define "elt-platform.registry" -}}
{{- .Values.global.registry -}}
{{- end }}

{{- define "elt-platform.imageTag" -}}
{{- .Values.global.imageTag -}}
{{- end }}

{{- define "elt-platform.apiImage" -}}
{{ printf "%s/%s:%s" (include "elt-platform.registry" .) .Values.api.image.repository (include "elt-platform.imageTag" .) }}
{{- end }}

{{- define "elt-platform.frontendImage" -}}
{{ printf "%s/%s:%s" (include "elt-platform.registry" .) .Values.frontend.image.repository (include "elt-platform.imageTag" .) }}
{{- end }}

{{- define "elt-platform.infraImage" -}}
{{ printf "%s/%s:%s" (include "elt-platform.registry" .) .Values.infra.image.repository (include "elt-platform.imageTag" .) }}
{{- end }}
